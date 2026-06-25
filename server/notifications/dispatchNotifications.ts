import type { Database } from "../db/index.ts";
import type { LiveEvent } from "../events/eventBus.ts";
import { notificationsEnabled } from "../lib/config.ts";
import {
  createTextbeltClient,
  type TextbeltClient,
  TextbeltConfigurationError,
} from "../providers/textbeltClient.ts";
import { getOrCreateEventTemplate } from "./eventTemplates.ts";
import { buildCanonicalEventContext, withProfileContext } from "./eventContext.ts";
import { getMediaInterestTargetForItem, profileHasMediaInterest } from "./mediaInterests.ts";
import type { NotificationProfile } from "./profiles.ts";
import {
  createPendingReceipt,
  markReceiptRejected,
  markReceiptRenderFailed,
  markReceiptSubmissionUnknown,
  markReceiptSubmitted,
  maskPhoneNumber,
} from "./receiptService.ts";
import { renderTemplate } from "./templateRenderer.ts";

type EligibleProfile = NotificationProfile & {
  preferenceId: number;
  phoneNumberId: number;
  dispatchPhoneNumber: string;
};

type SmsEligibilitySummary = {
  subscriptionRows: number;
  enabledProfiles: number;
  withPhone: number;
  optedIn: number;
  optedOut: number;
  eligible: number;
};

export type DispatchSummary = {
  attempted: number;
  submitted: number;
  rejected: number;
  renderFailed: number;
  submissionUnknown: number;
  skipped: number;
};

export async function dispatchNotificationsForEvent(
  db: Database,
  event: LiveEvent,
  optionsOrClient: { client?: TextbeltClient; mediaItemId?: number | null } | TextbeltClient = {},
): Promise<DispatchSummary> {
  const options = "sendSms" in optionsOrClient ? { client: optionsOrClient } : optionsOrClient;
  const client = options.client ?? createTextbeltClient();
  const summary: DispatchSummary = {
    attempted: 0,
    submitted: 0,
    rejected: 0,
    renderFailed: 0,
    submissionUnknown: 0,
    skipped: 0,
  };

  if (event.source === "test") {
    logNotification("info", "notifications.dispatch.skipped", {
      reason: "test_event",
      eventId: event.id,
      source: event.source,
      rawEventType: event.eventType,
    });
    return summary;
  }

  if (!notificationsEnabled()) {
    logNotification("info", "notifications.dispatch.skipped", {
      reason: "notifications_disabled",
      eventId: event.id,
      source: event.source,
      rawEventType: event.eventType,
    });
    return summary;
  }

  const canonical = buildCanonicalEventContext(event);
  if (!canonical) {
    logNotification("warn", "notifications.dispatch.skipped", {
      reason: "event_not_in_catalog",
      eventId: event.id,
      source: event.source,
      rawEventType: event.eventType,
    });
    return summary;
  }

  logNotification("info", "notifications.dispatch.started", {
    eventId: event.id,
    source: canonical.source,
    eventType: canonical.eventType,
    dedupeKey: canonical.eventDedupeKey,
  });

  const mediaTarget = getMediaInterestTargetForItem(db, options.mediaItemId);
  const profiles = listEligibleSmsProfiles(db, canonical.source, canonical.eventType)
    .filter((profile) => !mediaTarget || profileHasMediaInterest(db, profile.id, mediaTarget));

  if (profiles.length === 0) {
    logNotification("info", "notifications.dispatch.no_eligible_profiles", {
      eventId: event.id,
      source: canonical.source,
      eventType: canonical.eventType,
      ...getSmsEligibilitySummary(db, canonical.source, canonical.eventType),
      mediaInterestRequired: Boolean(mediaTarget),
    });
    return summary;
  }

  logNotification("info", "notifications.dispatch.eligible_profiles", {
    eventId: event.id,
    source: canonical.source,
    eventType: canonical.eventType,
    eligibleProfiles: profiles.length,
  });

  const template = getOrCreateEventTemplate(db, canonical.source, canonical.eventType);

  for (const profile of profiles) {
    summary.attempted += 1;
    const profileContext = withProfileContext(canonical, profile);
    const receipt = createPendingReceipt(db, {
      eventDedupeKey: canonical.eventDedupeKey,
      eventSource: canonical.source,
      eventType: canonical.eventType,
      eventTitle: canonical.eventTitle,
      profileId: profile.id,
      profilePhoneNumberId: profile.phoneNumberId,
      templateId: template.id,
      templateRevision: template.revision,
      renderedBody: null,
      renderContext: profileContext.templateContext,
      destinationMasked: maskPhoneNumber(profile.dispatchPhoneNumber),
    });

    if (!receipt) {
      summary.skipped += 1;
      logNotification("info", "notifications.dispatch.receipt_skipped", {
        reason: "duplicate_event_profile_channel",
        eventId: event.id,
        profileId: profile.id,
        phoneNumberId: profile.phoneNumberId,
        source: canonical.source,
        eventType: canonical.eventType,
        dedupeKey: canonical.eventDedupeKey,
      });
      continue;
    }

    const rendered = renderTemplate(
      canonical.source,
      canonical.eventType,
      template.smsBodyTemplate,
      profileContext.templateContext,
    );
    if (!rendered.ok) {
      markReceiptRenderFailed(db, receipt.id, rendered.errors, {
        missingVariables: rendered.missingVariables,
      });
      summary.renderFailed += 1;
      logNotification("warn", "notifications.dispatch.render_failed", {
        eventId: event.id,
        receiptId: receipt.id,
        profileId: profile.id,
        phoneNumberId: profile.phoneNumberId,
        source: canonical.source,
        eventType: canonical.eventType,
        missingVariables: rendered.missingVariables,
      });
      continue;
    }

    db.query("UPDATE message_receipts SET rendered_body = ?, updated_at = ? WHERE id = ?", [
      rendered.rendered,
      new Date().toISOString(),
      receipt.id,
    ]);

    try {
      const result = await client.sendSms(profile.dispatchPhoneNumber, rendered.rendered);
      if (result.kind === "submitted") {
        markReceiptSubmitted(db, receipt.id, {
          providerMessageId: result.textId,
          quotaRemaining: result.quotaRemaining,
          response: result.response,
        });
        summary.submitted += 1;
        logNotification("info", "notifications.dispatch.submitted", {
          eventId: event.id,
          receiptId: receipt.id,
          profileId: profile.id,
          phoneNumberId: profile.phoneNumberId,
          source: canonical.source,
          eventType: canonical.eventType,
          provider: "textbelt",
          providerMessageId: result.textId,
          quotaRemaining: result.quotaRemaining,
        });
      } else if (result.kind === "rejected") {
        markReceiptRejected(db, receipt.id, {
          error: result.error,
          quotaRemaining: result.quotaRemaining,
          response: result.response,
        });
        summary.rejected += 1;
        logNotification("warn", "notifications.dispatch.rejected", {
          eventId: event.id,
          receiptId: receipt.id,
          profileId: profile.id,
          phoneNumberId: profile.phoneNumberId,
          source: canonical.source,
          eventType: canonical.eventType,
          provider: "textbelt",
          error: result.error,
          quotaRemaining: result.quotaRemaining,
        });
      } else {
        markReceiptSubmissionUnknown(db, receipt.id, {
          error: result.error,
          response: result.response,
        });
        summary.submissionUnknown += 1;
        logNotification("warn", "notifications.dispatch.submission_unknown", {
          eventId: event.id,
          receiptId: receipt.id,
          profileId: profile.id,
          phoneNumberId: profile.phoneNumberId,
          source: canonical.source,
          eventType: canonical.eventType,
          provider: "textbelt",
          error: result.error,
        });
      }
    } catch (error) {
      if (error instanceof TextbeltConfigurationError) {
        markReceiptRejected(db, receipt.id, {
          error: error.message,
          quotaRemaining: null,
          response: { configured: false },
        });
        summary.rejected += 1;
        logNotification("warn", "notifications.dispatch.rejected", {
          eventId: event.id,
          receiptId: receipt.id,
          profileId: profile.id,
          phoneNumberId: profile.phoneNumberId,
          source: canonical.source,
          eventType: canonical.eventType,
          provider: "textbelt",
          error: error.message,
        });
      } else {
        const message = error instanceof Error
          ? error.message
          : "SMS submission failed ambiguously";
        markReceiptSubmissionUnknown(db, receipt.id, { error: message });
        summary.submissionUnknown += 1;
        logNotification("error", "notifications.dispatch.submission_unknown", {
          eventId: event.id,
          receiptId: receipt.id,
          profileId: profile.id,
          phoneNumberId: profile.phoneNumberId,
          source: canonical.source,
          eventType: canonical.eventType,
          provider: "textbelt",
          error: message,
        });
      }
    }
  }

  logNotification("info", "notifications.dispatch.finished", {
    eventId: event.id,
    source: canonical.source,
    eventType: canonical.eventType,
    ...summary,
  });
  return summary;
}

function listEligibleSmsProfiles(
  db: Database,
  source: string,
  eventType: string,
): EligibleProfile[] {
  return [...db.query(
    `
    SELECT np.id, np.display_name, np.enabled, np.phone_number, np.email_address,
      np.avatar_filename, np.avatar_content_type, pnp.opted_in_at, pnp.opted_out_at,
      np.created_at, np.updated_at, pep.id, pnp.id, pnp.phone_number
    FROM notification_profiles np
    JOIN profile_event_preferences pep ON pep.profile_id = np.id
    JOIN notification_profile_phone_numbers pnp ON pnp.profile_id = np.id
    WHERE np.enabled = 1
      AND pnp.enabled = 1
      AND pnp.phone_number IS NOT NULL
      AND pnp.opted_in_at IS NOT NULL
      AND pnp.opted_out_at IS NULL
      AND pep.source = ?
      AND pep.event_type = ?
      AND pep.enabled = 1
      AND pep.notify_sms = 1
    ORDER BY np.id ASC, pnp.id ASC
  `,
    [source, eventType],
  )].map((row) => ({
    id: Number(row[0]),
    displayName: String(row[1]),
    enabled: Number(row[2]) === 1,
    phoneNumber: row[3] === null ? null : String(row[3]),
    emailAddress: row[4] === null ? null : String(row[4]),
    avatarFilename: row[5] === null ? null : String(row[5]),
    avatarContentType: row[6] === null ? null : String(row[6]),
    smsOptedInAt: row[7] === null ? null : String(row[7]),
    smsOptedOutAt: row[8] === null ? null : String(row[8]),
    createdAt: String(row[9]),
    updatedAt: String(row[10]),
    preferenceId: Number(row[11]),
    phoneNumberId: Number(row[12]),
    dispatchPhoneNumber: String(row[13]),
  }));
}

function getSmsEligibilitySummary(
  db: Database,
  source: string,
  eventType: string,
): SmsEligibilitySummary {
  const row = [...db.query(
    `
    SELECT
      COUNT(*),
      SUM(CASE WHEN np.enabled = 1 THEN 1 ELSE 0 END),
      SUM(CASE WHEN np.enabled = 1 AND pnp.phone_number IS NOT NULL THEN 1 ELSE 0 END),
      SUM(CASE WHEN np.enabled = 1 AND pnp.phone_number IS NOT NULL AND pnp.opted_in_at IS NOT NULL THEN 1 ELSE 0 END),
      SUM(CASE WHEN np.enabled = 1 AND pnp.opted_out_at IS NOT NULL THEN 1 ELSE 0 END),
      SUM(CASE WHEN np.enabled = 1 AND pnp.enabled = 1 AND pnp.phone_number IS NOT NULL AND pnp.opted_in_at IS NOT NULL AND pnp.opted_out_at IS NULL THEN 1 ELSE 0 END)
    FROM profile_event_preferences pep
    JOIN notification_profiles np ON np.id = pep.profile_id
    LEFT JOIN notification_profile_phone_numbers pnp ON pnp.profile_id = np.id
    WHERE pep.source = ?
      AND pep.event_type = ?
      AND pep.enabled = 1
      AND pep.notify_sms = 1
  `,
    [source, eventType],
  )][0] ?? [0, 0, 0, 0, 0, 0];

  return {
    subscriptionRows: Number(row[0] ?? 0),
    enabledProfiles: Number(row[1] ?? 0),
    withPhone: Number(row[2] ?? 0),
    optedIn: Number(row[3] ?? 0),
    optedOut: Number(row[4] ?? 0),
    eligible: Number(row[5] ?? 0),
  };
}

function logNotification(
  level: "info" | "warn" | "error",
  name: string,
  fields: Record<string, unknown>,
): void {
  console[level](JSON.stringify({ event: name, at: new Date().toISOString(), ...fields }));
}
