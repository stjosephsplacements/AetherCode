// Installs the newest Piston runtime for each exam language (gcc provides C and
// C++). Idempotent: installed packages are skipped. Runs in the Piston image,
// whose Node 15 has no global fetch.
const http = require("http");

const BASE = "http://piston:2000/api/v2";
const PACKAGES = ["gcc", "java", "python"];

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      BASE + path,
      { method, headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {} },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => (res.statusCode < 300 ? resolve(JSON.parse(data || "null")) : reject(new Error(`${method} ${path}: ${res.statusCode} ${data}`))));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

function newer(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

async function main() {
  let packages;
  for (let attempt = 1; ; attempt++) {
    try {
      packages = await request("GET", "/packages");
      break;
    } catch (error) {
      if (attempt === 60) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  for (const name of PACKAGES) {
    const candidates = packages.filter((p) => p.language === name);
    if (candidates.length === 0) throw new Error(`no Piston package named ${name}`);
    const latest = candidates.reduce((best, p) => (newer(p.language_version, best.language_version) ? p : best));
    if (latest.installed) {
      console.log(`${name} ${latest.language_version} already installed`);
      continue;
    }
    console.log(`installing ${name} ${latest.language_version}`);
    await request("POST", "/packages", { language: name, version: latest.language_version });
  }
  const runtimes = await request("GET", "/runtimes");
  console.log("runtimes:", runtimes.map((r) => `${r.language} ${r.version}`).join(", "));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
