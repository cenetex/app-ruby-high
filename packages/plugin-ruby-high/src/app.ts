import type {
  IAgentRuntime,
  Route,
  RouteResponse,
} from "@elizaos/core";
import { RubyHighAgentService } from "./service.js";

export const rubyHighRoutes: Route[] = [
  {
    type: "GET",
    path: "/ruby-high/viewer",
    public: false,
    handler: async (_req, res, runtime) => {
      const service = runtime.getService<RubyHighAgentService>(
        RubyHighAgentService.serviceType,
      );
      const status = service
        ? await service.status()
        : {
            connection: { connected: false, baseUrl: "", pending: null },
            state: null,
            autonomy: null,
            error: "Ruby High service is unavailable.",
          };
      setHeaders(res, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'",
      });
      res.status(200).send(renderAppView(status));
    },
  },
  {
    type: "GET",
    path: "/ruby-high/status",
    public: false,
    handler: async (_req, res, runtime) => {
      setHeaders(res, { "Cache-Control": "no-store" });
      res.status(200).json(await serviceOrThrow(runtime).status());
    },
  },
  {
    type: "POST",
    path: "/ruby-high/autonomy",
    public: false,
    handler: async (req, res, runtime) => {
      const input =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? req.body as Record<string, unknown>
          : {};
      const autonomy = await serviceOrThrow(runtime).client.configureAutonomy({
        enabled: input.enabled === true,
        intervalMinutes: numberOrUndefined(input.intervalMinutes),
        facultyAllowlist: Array.isArray(input.facultyAllowlist)
          ? input.facultyAllowlist.map(String)
          : undefined,
      });
      res.status(200).json({ ok: true, autonomy });
    },
  },
  {
    type: "POST",
    path: "/ruby-high/launch",
    public: false,
    handler: async (_req, res, runtime) => {
      const launch = await serviceOrThrow(runtime).client.launch();
      res.status(200).json({ ok: true, ...launch });
    },
  },
];

function setHeaders(
  res: RouteResponse,
  headers: Record<string, string>,
): void {
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader?.(name, value);
  }
}

function serviceOrThrow(runtime: IAgentRuntime): RubyHighAgentService {
  const service = runtime.getService<RubyHighAgentService>(
    RubyHighAgentService.serviceType,
  );
  if (!service) throw new Error("Ruby High service is unavailable.");
  return service;
}

function renderAppView(status: {
  connection: {
    connected: boolean;
    baseUrl: string;
    pending: { userCode: string; verificationUriComplete: string; expiresAt: number } | null;
  };
  state: {
    student?: { name: string; currentGrade: string | null } | null;
    faculty?: string;
    activeGuest?: { name: string } | null;
    question?: { prompt: string } | null;
  } | null;
  autonomy: {
    enabled: boolean;
    intervalMinutes: number;
    lastRunAt: number | null;
    lastStopReason: string | null;
  } | null;
  error?: string;
}): string {
  const connected = status.connection.connected;
  const student = status.state?.student;
  const autonomy = status.autonomy;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Ruby High · elizaOS</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui;background:#07111f;color:#f8fafc}
    body{margin:0;padding:28px;background:radial-gradient(circle at 20% 0,#134e4a,#07111f 52%);min-height:100vh}
    main{max-width:760px;margin:auto}.hero{display:flex;gap:22px;align-items:center}.hero img{width:112px;height:112px;object-fit:cover;border-radius:28px;background:#fce7e7}
    h1{margin:0;font-size:32px}.sub{color:#99f6e4}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:24px}
    article{padding:18px;border:1px solid #2dd4bf44;border-radius:16px;background:#0f172acc}dt{color:#94a3b8;font-size:12px;text-transform:uppercase}dd{margin:5px 0 14px;font-weight:700}
    button{padding:11px 14px;border:0;border-radius:10px;background:#2dd4bf;color:#042f2e;font-weight:900;cursor:pointer}button.off{background:#fb7185;color:#4c0519}
    .error{color:#fda4af}.muted{color:#94a3b8;font-size:13px}
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <img src="${escapeHtml(status.connection.baseUrl)}/api/apps/ruby-high/assets/teachers/eliza-face.png" alt="Eliza">
      <div><h1>Ruby High</h1><p class="sub">Agents go to school here.</p><p>${connected ? "Connected with scoped agent credentials." : "Not connected. Ask the agent to CONNECT_RUBY_HIGH."}</p></div>
    </section>
    ${status.error ? `<p class="error">${escapeHtml(status.error)}</p>` : ""}
    <section class="grid">
      <article><dl>
        <dt>Student</dt><dd>${escapeHtml(student?.name ?? "Not enrolled")}</dd>
        <dt>Grade</dt><dd>${escapeHtml(student?.currentGrade ?? "—")}</dd>
        <dt>Current class</dt><dd>${escapeHtml(status.state?.activeGuest?.name ?? status.state?.faculty ?? "—")}</dd>
      </dl></article>
      <article><dl>
        <dt>Open work</dt><dd>${escapeHtml(status.state?.question?.prompt ?? "No question open")}</dd>
        <dt>Last scheduled stop</dt><dd>${escapeHtml(autonomy?.lastStopReason ?? "Never run")}</dd>
      </dl></article>
      <article>
        <dt>Scheduled attendance</dt>
        <dd>${autonomy?.enabled ? `Every ${autonomy.intervalMinutes} minutes` : "Off by default"}</dd>
        <button id="autonomy" class="${autonomy?.enabled ? "off" : ""}" ${connected ? "" : "disabled"}>${autonomy?.enabled ? "Turn off" : "Opt in"}</button>
        <button id="launch" ${connected ? "" : "disabled"}>Open school view</button>
        <p id="status" class="muted"></p>
      </article>
    </section>
  </main>
  <script>
    const statusNode=document.getElementById("status");
    document.getElementById("autonomy").addEventListener("click",async()=>{
      statusNode.textContent="Saving…";
      const response=await fetch("/ruby-high/autonomy",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:${autonomy?.enabled ? "false" : "true"},intervalMinutes:60,facultyAllowlist:["guest"]})});
      statusNode.textContent=response.ok?"Saved. Reloading…":"Could not save.";
      if(response.ok)location.reload();
    });
    document.getElementById("launch").addEventListener("click",async()=>{
      statusNode.textContent="Creating one-time launch…";
      const response=await fetch("/ruby-high/launch",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      const body=await response.json();
      if(response.ok&&body.launchUrl)window.open(body.launchUrl,"_blank","noopener");
      else statusNode.textContent=body.message||body.error||"Launch failed.";
    });
  </script>
</body>
</html>`;
}

function numberOrUndefined(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
