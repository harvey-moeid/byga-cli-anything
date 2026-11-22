import { useEffect, useState, type FormEvent } from "react";

type Repo = { id: string; full_name: string; default_branch: string; visibility: string };
type Job = { id: string; repository_full_name: string; ref: string; task: string; status: string; created_at: string };
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
          </div>)}
        </section>}

        {page === "jobs" && <>
          <section className="panel"><h3>Start manual execution</h3><p>Workflow hanya berjalan setelah tombol ditekan.</p>
            <form className="jobform" onSubmit={startJob}>
              <label>Repository<select value={selected} onChange={event => setSelected(event.target.value)} required>
                <option value="">Choose repository</option>{repos.map(repository => <option value={repository.id} key={repository.id}>{repository.full_name}</option>)}
              </select></label>
              <label>Branch / tag / ref<input value={ref} onChange={event => setRef(event.target.value)} required /></label>
              <label>Task<select value={task} onChange={event => setTask(event.target.value)}>
                <option value="audit">Audit only</option><option value="generate">Generate harness (adapter required)</option>
              </select></label>
              <button disabled={busy || !repos.length}>Run job →</button>
            </form>
          </section>
          <section className="panel"><h3>Execution history</h3><JobTable jobs={jobs} /></section>
        </>}

        {page === "artifacts" && <section className="panel">
          <h3>Artifacts</h3><p>Artifact tersedia setelah workflow selesai dan upload berhasil. Retensi awal 7 hari.</p>
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
  return <div className="table"><table><thead><tr><th>Repository</th><th>Task</th><th>Status</th><th>Created</th></tr></thead>
    <tbody>{jobs.map(job => <tr key={job.id}>
      <td>{job.repository_full_name}<small>{job.id.slice(0, 8)} · {job.ref}</small></td>
      <td>{job.task}</td><td><span className={"status " + job.status.toLowerCase()}>{job.status}</span></td>
      <td>{new Date(job.created_at).toLocaleString("id-ID")}</td>
    </tr>)}</tbody></table>
    {!jobs.length && <p>No executions yet.</p>}
  </div>;
}
