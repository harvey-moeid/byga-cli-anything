import { useEffect, useState, type FormEvent } from "react";

type Repo = { id: string; full_name: string; default_branch: string; visibility: string };
type Job = { id: string; repository_full_name: string; ref: string; task: string; status: string; created_at: string; result_json?: string | null; workflow_url?: string | null };
type Branch = { name: string; sha: string };
type Artifact = { id: number; name: string; size_in_bytes: number; expired: boolean; expires_at: string; job_id: string; repository_full_name: string };
const API = import.meta.env.VITE_API_BASE || "";

async function request(path: string, init?: RequestInit) {
  const response = await fetch(API + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    credentials: "include",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function App() {
  const [page, setPage] = useState("overview");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [stats, setStats] = useState<{ repositories: number }>({ repositories: 0 });
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState("");
  const [ref, setRef] = useState("main");
  const [task, setTask] = useState("audit");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setError("");
      const [repositoryData, jobData, dashboardData] = await Promise.all([
        request("/api/repositories"), request("/api/jobs"), request("/api/dashboard"),
      ]);
      setRepos(repositoryData);
      setJobs(jobData);
      setStats(dashboardData);
      if (!selected && repositoryData[0]) setSelected(repositoryData[0].id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load dashboard");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selected) { setBranches([]); return; }
    request("/api/repositories/" + selected + "/branches")
      .then(data => setBranches(data))
      .catch(cause => setError(cause instanceof Error ? cause.message : "Branch listing failed"));
  }, [selected]);

  useEffect(() => {
    if (page === "artifacts") {
      request("/api/artifacts")
        .then(data => setArtifacts(data))
        .catch(cause => setError(cause instanceof Error ? cause.message : "Artifact listing failed"));
    }
  }, [page]);

  async function addRepository(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const fullName = url.trim().replace("https://github.com/", "").replace("http://github.com/", "").replace(".git", "").replace(/\/$/, "");
      const result = await request("/api/repositories", {
        method: "POST", body: JSON.stringify({ fullName }),
      });
      setUrl("");
      await refresh();
      setSelected(result.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Repository validation failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeRepository(repository: Repo) {
    if (!window.confirm("Remove " + repository.full_name + " from the allowlist?")) return;
    try {
      await request("/api/repositories/" + repository.id, { method: "DELETE" });
      if (selected === repository.id) setSelected("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to remove repository");
    }
  }

  async function startJob(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await request("/api/jobs", {
        method: "POST", body: JSON.stringify({ repositoryId: selected, ref, task }),
      });
      setPage("jobs");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start job");
    } finally {
      setBusy(false);
    }
  }

  const navigation = [
    ["overview", "Overview"], ["repositories", "Repositories"], ["jobs", "Jobs"],
    ["artifacts", "Artifacts"], ["settings", "Settings"],
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><b className="mark">B</b><div><b>BYGA</b><small>CLI-Anything</small></div></div>
        <nav>{navigation.map(([id, label]) => (
          <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)}>{label}</button>
        ))}</nav>
        <div className="foot">● Manual execution only<br /><small>Cloudflare · GitHub Actions</small></div>
      </aside>

      <main>
        <header>
          <div><small>CONTROL PLANE / SECURE EXECUTION</small><h1>{navigation.find(([id]) => id === page)?.[1]}</h1></div>
          <button className="secondary" onClick={() => void refresh()}>↻ Refresh</button>
        </header>
        {error && <div className="alert">{error}</div>}

        {page === "overview" && <>
          <section className="hero">
            <div><span className="tag">MANUAL MODE</span><h2>Build agent-native CLIs.<br /><em>From your phone.</em></h2>
              <p>Kelola repository, audit source, jalankan harness job, dan tinjau artifact dari satu dashboard.</p>
              <button onClick={() => setPage("jobs")}>Open job manager →</button>
            </div>
            <div className="orb">CLI <b>+</b> AI</div>
          </section>
          <section className="metrics">
            {[["Repositories", stats.repositories || 0], ["Total jobs", jobs.length],
              ["Running", jobs.filter(j => ["RUNNING", "TESTING"].includes(j.status)).length],
              ["Completed", jobs.filter(j => j.status === "COMPLETED").length]].map(([label, value]) => (
              <article key={label}><small>{label}</small><strong>{value}</strong><small>Database count</small></article>
            ))}
          </section>
          <section className="panel"><h3>Recent executions</h3><JobTable jobs={jobs.slice(0, 6)} /></section>
        </>}

        {page === "repositories" && <section className="panel">
          <h3>Repository allowlist</h3><p>Hanya repository terdaftar yang dapat dieksekusi.</p>
          <form className="add" onSubmit={addRepository}>
            <input value={url} onChange={event => setUrl(event.target.value)} placeholder="owner/repository atau GitHub URL" required />
            <button disabled={busy}>Validate &amp; add</button>
          </form>
          {repos.map(repository => <div className="repo" key={repository.id}>
            <b>⌘</b><div>{repository.full_name}<small>{repository.default_branch} · {repository.visibility}</small></div>
            <span className="tag">Allowed</span>
            <button className="logButton" onClick={() => void removeRepository(repository)}>Remove</button>
          </div>)}
        </section>}

        {page === "jobs" && <>
          <section className="panel"><h3>Start manual execution</h3><p>Workflow hanya berjalan setelah tombol ditekan.</p>
            <form className="jobform" onSubmit={startJob}>
              <label>Repository<select value={selected} onChange={event => setSelected(event.target.value)} required>
                <option value="">Choose repository</option>{repos.map(repository => <option value={repository.id} key={repository.id}>{repository.full_name}</option>)}
              </select></label>
              <label>Known branch<select value={branches.some(branch => branch.name === ref) ? ref : ""} onChange={event => setRef(event.target.value)}>
                <option value="">Choose a branch (optional)</option>{branches.map(branch => <option value={branch.name} key={branch.name}>{branch.name} · {branch.sha.slice(0, 8)}</option>)}
              </select></label>
              <label>Branch / tag / commit SHA<input value={ref} onChange={event => setRef(event.target.value)} required /></label>
              <label>Task<select value={task} onChange={event => setTask(event.target.value)}>
                <option value="audit">Audit only</option><option value="generate">Generate harness (adapter required)</option>
              </select></label>
              <button disabled={busy || !repos.length}>Run job →</button>
            </form>
          </section>
          <section className="panel"><h3>Execution history</h3><JobTable jobs={jobs} /></section>
        </>}

        {page === "artifacts" && <section className="panel">
          <h3>Artifacts</h3><p>File disimpan di GitHub Actions dengan retensi 7 hari. Daftar ini hanya menampilkan artifact yang benar-benar tersedia.</p>
          {artifacts.length ? artifacts.map(artifact => <div className="repo" key={artifact.id}>
            <b>ZIP</b><div><strong>{artifact.name}</strong><small>{artifact.repository_full_name} · {(artifact.size_in_bytes / 1024).toFixed(1)} KB · Expires {new Date(artifact.expires_at).toLocaleDateString("id-ID")}</small></div>
            {artifact.expired ? <span className="tag">Expired</span> : <a href={API + "/api/artifacts/" + artifact.id + "/download?jobId=" + encodeURIComponent(artifact.job_id)}>Download ↧</a>}
          </div>) : <p>Belum ada artifact. Jalankan audit manual dan tunggu workflow selesai.</p>}
          <a href="https://github.com/harvey-moeid/byga-cli-anything/actions" target="_blank" rel="noreferrer">Open GitHub Actions ↗</a>
        </section>}

        {page === "settings" && <section className="panel">
          <h3>Integrations &amp; security</h3><p>GitHub API: Worker secret required</p><p>Cloudflare Access: required</p>
          <p>BYGA Agent: adapter not configured</p><p>Execution: manual workflow_dispatch</p>
          <small>Secrets tidak pernah ditampilkan di dashboard.</small>
        </section>}
        <footer>BYGA CLI-Anything · Secure by default · No automatic deployment</footer>
      </main>

      <nav className="mobile">{navigation.map(([id, label]) => (
        <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)}>{label}</button>
      ))}</nav>
    </div>
  );
}

function JobTable({ jobs }: { jobs: Job[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [logText, setLogText] = useState<Record<string, string>>({});
  const [logLoading, setLogLoading] = useState<string | null>(null);
  const [logError, setLogError] = useState("");

  async function toggleLogs(job: Job) {
    if (expanded === job.id) {
      setExpanded(null);
      return;
    }
    setExpanded(job.id);
    setLogError("");
    if (logText[job.id]) return;
    setLogLoading(job.id);
    try {
      const data = await request("/api/jobs/" + job.id + "/logs");
      const combined = (data.jobs || []).map((item: { name: string; status: string; conclusion: string | null; logs: string }) =>
        "=== " + item.name + " · " + item.status + " · " + (item.conclusion || "in progress") + " ===\n" + item.logs
      ).join("\n");
      setLogText(previous => ({ ...previous, [job.id]: combined || "No log output returned." }));
    } catch (cause) {
      setLogError(cause instanceof Error ? cause.message : "Log retrieval failed");
    } finally {
      setLogLoading(null);
    }
  }

  return <div className="table">
    <table><thead><tr><th>Repository</th><th>Task</th><th>Status</th><th>Created</th><th>Logs</th></tr></thead>
      <tbody>{jobs.map(job => <tr key={job.id}>
        <td>{job.repository_full_name}<small>{job.id.slice(0, 8)} · {job.ref}</small></td>
        <td>{job.task}</td>
        <td><span className={"status " + job.status.toLowerCase()}>{job.status}</span></td>
        <td>{new Date(job.created_at).toLocaleString("id-ID")}</td>
        <td><button className="logButton" disabled={!job.workflow_url || logLoading === job.id} onClick={() => void toggleLogs(job)}>
          {logLoading === job.id ? "Loading…" : expanded === job.id ? "Hide" : "View"}
        </button></td>
      </tr>)}</tbody>
    </table>
    {expanded && <section className="report">
      <b>Execution logs · {expanded.slice(0, 8)}</b>
      {logError && <p>{logError}</p>}
      <pre>{logText[expanded] || (logLoading === expanded ? "Loading logs…" : "Logs not available yet.")}</pre>
    </section>}
    {jobs.filter(job => job.result_json).map(job => <details className="report" key={job.id}>
      <summary>Audit report · {job.repository_full_name} · {job.id.slice(0, 8)}</summary>
      <pre>{(() => { try { return JSON.stringify(JSON.parse(job.result_json || "{}"), null, 2); } catch { return "Report JSON tidak valid."; } })()}</pre>
      {job.workflow_url && <a href={job.workflow_url} target="_blank" rel="noreferrer">Open workflow ↗</a>}
    </details>)}
    {!jobs.length && <p>No executions yet.</p>}
  </div>;
}
