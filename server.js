import "dotenv/config";
import express from "express";
import { exec }  from "child_process";
import cors      from "cors";
import fetch     from "node-fetch";

const app = express();
app.use(express.json());
app.use(cors({
  origin: [
    "https://mariaalgo.online",
    "https://www.mariaalgo.online",
    process.env.CLIENT_ORIGIN || "http://localhost:5173",
    "http://localhost:3000",
  ],
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
}));

// ─── pm2 name → port map ──────────────────────────────────────────────────────
const ENGINES = {
  ic: { name: "iron-condor",   port: 3002 },
  tl: { name: "trafic-light",  port: 3001 },
  dn: { name: "debit-neutral", port: 3004 },
};

// Run a shell command, return stdout/stderr
const run = (cmd) =>
  new Promise((resolve) => {
    exec(cmd, (err, stdout, stderr) => {
      resolve({ ok: !err, out: stdout?.trim(), err: stderr?.trim() || err?.message });
    });
  });

// Check if engine HTTP server is actually responding
const isResponding = async (port) => {
  try {
    const res = await fetch(`http://localhost:${port}/status`, { timeout: 2000 });
    return res.ok;
  } catch {
    return false;
  }
};

// ─── GET /control/status ──────────────────────────────────────────────────────
// Returns pm2 status + HTTP reachability for each engine
app.get("/control/status", async (_req, res) => {
  try {
    const { out } = await run("pm2 jlist");
    const list = JSON.parse(out || "[]");

    const result = {};
    for (const [key, cfg] of Object.entries(ENGINES)) {
      const proc   = list.find((p) => p.name === cfg.name);
      const pm2Up  = proc?.pm2_env?.status === "online";
      const httpUp = pm2Up ? await isResponding(cfg.port) : false;
      result[key]  = {
        pm2:    proc?.pm2_env?.status || "stopped",
        http:   httpUp,
        uptime: proc?.pm2_env?.pm_uptime || null,
        restarts: proc?.pm2_env?.restart_time ?? 0,
      };
    }

    res.json({ ok: true, engines: result, ts: Date.now() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── POST /control/:engine/stop ───────────────────────────────────────────────
app.post("/control/:engine/stop", async (req, res) => {
  const cfg = ENGINES[req.params.engine];
  if (!cfg) return res.status(404).json({ ok: false, error: "Unknown engine" });

  const { ok, err } = await run(`pm2 stop ${cfg.name}`);
  if (ok) res.json({ ok: true, message: `${cfg.name} stopped` });
  else     res.status(500).json({ ok: false, error: err });
});

// ─── POST /control/:engine/start ─────────────────────────────────────────────
app.post("/control/:engine/start", async (req, res) => {
  const cfg = ENGINES[req.params.engine];
  if (!cfg) return res.status(404).json({ ok: false, error: "Unknown engine" });

  const { ok, err } = await run(`pm2 start ${cfg.name}`);
  if (ok) res.json({ ok: true, message: `${cfg.name} started` });
  else     res.status(500).json({ ok: false, error: err });
});

// ─── POST /control/:engine/restart ───────────────────────────────────────────
app.post("/control/:engine/restart", async (req, res) => {
  const cfg = ENGINES[req.params.engine];
  if (!cfg) return res.status(404).json({ ok: false, error: "Unknown engine" });

  const { ok, err } = await run(`pm2 restart ${cfg.name}`);
  if (ok) res.json({ ok: true, message: `${cfg.name} restarted` });
  else     res.status(500).json({ ok: false, error: err });
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get("/status", (_req, res) =>
  res.json({ status: "Online", strategy: "Control Server", timestamp: new Date() })
);

const PORT = process.env.CONTROL_PORT || 3003;
app.listen(PORT, () => console.log(`🎛️  Control Server online · port ${PORT}`));