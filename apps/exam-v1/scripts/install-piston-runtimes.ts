// Installs the C/C++, Java and Python runtimes into the Piston engine at ENGINE_URL.
const RUNTIMES = [
  ["gcc", "10.2.0"],
  ["python", "3.12.0"],
  ["java", "15.0.2"],
] as const;

const url = process.env.ENGINE_URL;
if (!url) throw new Error("ENGINE_URL is required");
for (const [language, version] of RUNTIMES) {
  const response = await fetch(`${url}/api/v2/packages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ language, version }),
  });
  console.log(`${language} ${version}: ${response.status} ${await response.text()}`);
}
export {};
