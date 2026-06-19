import LogoutIcon from "@mui/icons-material/Logout";
import SettingsIcon from "@mui/icons-material/Settings";
import SmsIcon from "@mui/icons-material/Sms";
import StorageIcon from "@mui/icons-material/Storage";
import TuneIcon from "@mui/icons-material/Tune";
import {
  Alert,
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  CssBaseline,
  Grid,
  IconButton,
  Stack,
  TextField,
  ThemeProvider,
  Toolbar,
  Tooltip,
  Typography,
  createTheme,
} from "@mui/material";
import { FormEvent, useEffect, useState } from "react";

type VersionResponse = {
  ok: boolean;
  app: string;
  version: string;
  runtime: string;
  environment: string;
  build: {
    sha: string | null;
    date: string | null;
  };
};

type User = {
  id: number;
  username: string;
  role: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

type AuthStatus = {
  ok: boolean;
  hasUsers: boolean;
};

type OverviewResponse = {
  ok: boolean;
  app: string;
  status: string;
  counts: {
    receipts: number;
    profiles: number;
    templates: number;
    users: number;
  };
  providerConfigured: boolean;
};

const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#1f6f5b",
    },
    background: {
      default: "#f5f7f8",
    },
  },
  shape: {
    borderRadius: 8,
  },
});

function App() {
  const [version, setVersion] = useState<VersionResponse | null>(null);
  const [backendStatus, setBackendStatus] = useState<"loading" | "online" | "error">("loading");
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);

  useEffect(() => {
    fetchVersion();
    fetchAuthState();
  }, []);

  useEffect(() => {
    if (!user) {
      setOverview(null);
      return;
    }

    fetch("/api/admin/overview")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Overview returned ${response.status}`);
        }

        return response.json() as Promise<OverviewResponse>;
      })
      .then(setOverview)
      .catch(() => setOverview(null));
  }, [user]);

  function fetchVersion() {
    fetch("/api/version")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Backend returned ${response.status}`);
        }

        return response.json() as Promise<VersionResponse>;
      })
      .then((data) => {
        setVersion(data);
        setBackendStatus("online");
      })
      .catch(() => {
        setBackendStatus("error");
      });
  }

  function fetchAuthState() {
    setAuthLoading(true);

    Promise.all([
      fetch("/api/auth/status").then((response) => response.json() as Promise<AuthStatus>),
      fetch("/api/auth/me"),
    ])
      .then(async ([statusData, meResponse]) => {
        setAuthStatus(statusData);

        if (meResponse.ok) {
          const data = (await meResponse.json()) as { ok: boolean; user: User };
          setUser(data.user);
        } else {
          setUser(null);
        }
      })
      .finally(() => setAuthLoading(false));
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError(null);
    setLoginLoading(true);

    const formData = new FormData(event.currentTarget);
    const username = String(formData.get("username") || "");
    const password = String(formData.get("password") || "");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Login failed");
      }

      setUser(data.user);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Login failed");
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setOverview(null);
    fetchAuthState();
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
        <AppBar position="static" elevation={0}>
          <Toolbar>
            <Typography variant="h6" component="h1" sx={{ fontWeight: 700, flexGrow: 1 }}>
              SMS Gateway
            </Typography>
            {user && (
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2">{user.username}</Typography>
                <Tooltip title="Log out">
                  <IconButton color="inherit" onClick={handleLogout} aria-label="Log out">
                    <LogoutIcon />
                  </IconButton>
                </Tooltip>
              </Stack>
            )}
          </Toolbar>
        </AppBar>

        {authLoading ? (
          <Stack alignItems="center" justifyContent="center" sx={{ minHeight: "70vh" }}>
            <CircularProgress />
          </Stack>
        ) : user ? (
          <Dashboard version={version} status={backendStatus} overview={overview} />
        ) : (
          <LoginScreen
            authStatus={authStatus}
            error={loginError}
            loading={loginLoading}
            onSubmit={handleLogin}
          />
        )}
      </Box>
    </ThemeProvider>
  );
}

function LoginScreen({
  authStatus,
  error,
  loading,
  onSubmit,
}: {
  authStatus: AuthStatus | null;
  error: string | null;
  loading: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Card variant="outlined">
        <CardContent>
          <Stack component="form" spacing={3} onSubmit={onSubmit}>
            <Stack spacing={1}>
              <Typography variant="h5" component="h2">
                Admin login
              </Typography>
              <Typography color="text.secondary">
                Sign in with the local admin account for this container.
              </Typography>
            </Stack>

            {authStatus && !authStatus.hasUsers && (
              <Alert severity="warning">
                No admin user has been bootstrapped. Set ADMIN_PASSWORD and restart the container.
              </Alert>
            )}

            {error && <Alert severity="error">{error}</Alert>}

            <TextField name="username" label="Username" autoComplete="username" required fullWidth />
            <TextField
              name="password"
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              fullWidth
            />
            <Button type="submit" variant="contained" disabled={loading} fullWidth>
              {loading ? "Signing in" : "Sign in"}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}

function Dashboard({
  version,
  status,
  overview,
}: {
  version: VersionResponse | null;
  status: "loading" | "online" | "error";
  overview: OverviewResponse | null;
}) {
  const placeholders = [
    {
      title: "Message Receipts",
      body: `${overview?.counts.receipts ?? 0} receipts stored.`,
      icon: <StorageIcon />,
    },
    {
      title: "Notification Profiles",
      body: `${overview?.counts.profiles ?? 0} profiles configured.`,
      icon: <TuneIcon />,
    },
    {
      title: "Event Templates",
      body: `${overview?.counts.templates ?? 0} templates configured.`,
      icon: <SmsIcon />,
    },
    {
      title: "Provider Settings",
      body: overview?.providerConfigured
        ? "Twilio environment placeholders are configured."
        : "Twilio environment placeholders are incomplete.",
      icon: <SettingsIcon />,
    },
  ];

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Grid container spacing={3}>
        <Grid item xs={12} md={7}>
          <Card variant="outlined">
            <CardContent>
              <Stack spacing={2}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="h5" component="h2">
                    Admin panel online
                  </Typography>
                  <Chip
                    size="small"
                    label={status === "online" ? "Backend online" : status}
                    color={status === "online" ? "success" : status === "error" ? "error" : "default"}
                  />
                </Stack>
                <Typography color="text.secondary">
                  Internal dashboard for webhook status, provider configuration, and future notification controls.
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={5}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" component="h2" gutterBottom>
                Backend Status
              </Typography>
              <Stack spacing={1}>
                <Typography variant="body2" color="text.secondary">
                  App: {version?.app ?? "Loading"}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Version: {version?.version ?? "Loading"}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Runtime: {version?.runtime ?? "Loading"}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Environment: {version?.environment ?? "Loading"}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Users: {overview?.counts.users ?? 0}
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {placeholders.map((item) => (
          <Grid key={item.title} item xs={12} sm={6} md={3}>
            <Card variant="outlined" sx={{ height: "100%" }}>
              <CardContent>
                <Stack spacing={2}>
                  <Box color="primary.main">{item.icon}</Box>
                  <Typography variant="h6" component="h2">
                    {item.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {item.body}
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Container>
  );
}

export default App;
