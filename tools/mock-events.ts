type MockSource = "jellyfin" | "seerr" | "radarr" | "sonarr" | "sabnzbd" | "test";

type MockEvent = {
  source: MockSource;
  payload: Record<string, unknown>;
};

const sources: MockSource[] = ["jellyfin", "seerr", "radarr", "sonarr", "sabnzbd", "test"];
const titles = [
  "The Grand Budapest Hotel",
  "Severance",
  "Andor",
  "The Expanse",
  "Arrival",
  "Blade Runner 2049",
  "Silo",
  "Dune: Part Two",
];
const users = ["alex", "jordan", "sam", "taylor", "morgan"];
const quality = ["1080p", "2160p", "Bluray", "WEB-DL", "Remux"];

const args = new Set(Deno.args);
const once = args.has("--once");
const intervalMs = readIntegerEnv("MOCK_EVENT_INTERVAL_MS", 2500);
const baseUrl = getBaseUrl();
const sharedSecret = Deno.env.get("SHARED_SECRET")?.trim();

if (args.has("--help")) {
  printHelp();
  Deno.exit(0);
}

console.log(
  `Mock webhook target: ${baseUrl} (${once ? "one event" : `every ${intervalMs}ms`})`,
);

if (once) {
  await postMockEvent(createMockEvent());
  Deno.exit(0);
}

while (true) {
  await postMockEvent(createMockEvent());
  await delay(intervalMs);
}

async function postMockEvent(event: MockEvent): Promise<void> {
  const response = await fetch(`${baseUrl}/webhook/${event.source}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sharedSecret ? { "x-sms-secret": sharedSecret } : {}),
    },
    body: JSON.stringify(event.payload),
  });

  const status = response.ok ? "ok" : "failed";
  console.log(
    `${new Date().toLocaleTimeString()} ${status} ${event.source} ${response.status} ${
      String(event.payload.eventType || event.payload.NotificationType || "event")
    }`,
  );

  if (!response.ok) {
    const body = await response.text();
    console.log(body);
  }
}

function createMockEvent(): MockEvent {
  const source = pick(sources);

  if (source === "jellyfin") {
    return {
      source,
      payload: {
        eventType: pick(["PlaybackStart", "PlaybackStop", "ItemAdded", "ItemPlayed"]),
        title: pick(titles),
        message: `${pick(users)} ${pick(["started", "stopped", "finished"])} playback`,
        userName: pick(users),
        itemType: pick(["Movie", "Episode"]),
      },
    };
  }

  if (source === "seerr") {
    return {
      source,
      payload: {
        notificationType: pick(["MEDIA_PENDING", "MEDIA_APPROVED", "MEDIA_AVAILABLE"]),
        subject: pick(titles),
        message: `Request ${pick(["created", "approved", "became available"])}`,
        requestedBy: pick(users),
      },
    };
  }

  if (source === "radarr") {
    return {
      source,
      payload: {
        eventType: pick(["MovieGrabbed", "MovieDownloaded", "MovieFileDelete", "HealthIssue"]),
        movie: {
          title: pick(titles),
          year: pick([2016, 2019, 2021, 2024]),
        },
        quality: pick(quality),
        message: pick(["Grabbed from indexer", "Download imported", "File deleted", "Health check warning"]),
      },
    };
  }

  if (source === "sonarr") {
    return {
      source,
      payload: {
        eventType: pick(["EpisodeGrabbed", "Download", "SeriesDelete", "HealthIssue"]),
        series: {
          title: pick(titles),
        },
        episode: {
          title: `Episode ${randomInt(1, 12)}`,
          seasonNumber: randomInt(1, 4),
          episodeNumber: randomInt(1, 12),
        },
        message: pick(["Episode grabbed", "Episode imported", "Series deleted", "Health issue detected"]),
      },
    };
  }

  if (source === "sabnzbd") {
    return {
      source,
      payload: {
        eventType: pick(["DownloadComplete", "DownloadFailed", "QueuePaused", "QueueResumed"]),
        name: `${pick(titles)}.${pick(quality)}`,
        status: pick(["Completed", "Failed", "Paused", "Running"]),
        message: pick(["Job completed", "Job failed", "Queue paused", "Queue resumed"]),
      },
    };
  }

  return {
    source,
    payload: {
      eventType: pick(["hello", "heartbeat", "warning", "error"]),
      title: "Mock test event",
      message: pick(["Live console check", "Synthetic event", "Filter test", "SSE test"]),
      token: "mock-secret-should-redact",
    },
  };
}

function getBaseUrl(): string {
  const explicitUrl = Deno.env.get("WEBHOOK_BASE_URL")?.trim();

  if (explicitUrl) {
    return explicitUrl.replace(/\/+$/, "");
  }

  return `http://localhost:${Deno.env.get("PORT")?.trim() || "3020"}`;
}

function readIntegerEnv(name: string, fallback: number): number {
  const rawValue = Deno.env.get(name);
  const value = rawValue ? Number(rawValue) : fallback;

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid ${name} value: ${rawValue}`);
  }

  return value;
}

function pick<T>(items: T[]): T {
  return items[randomInt(0, items.length - 1)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function printHelp(): void {
  console.log(`Mock webhook event generator

Usage:
  deno task mock:events
  deno task mock:events:once

Environment:
  WEBHOOK_BASE_URL          Target base URL. Defaults to http://localhost:$PORT.
  PORT                      Used for default target URL. Defaults to 3020.
  SHARED_SECRET             Sent as x-sms-secret when set.
  MOCK_EVENT_INTERVAL_MS    Continuous mode interval. Defaults to 2500.
`);
}
