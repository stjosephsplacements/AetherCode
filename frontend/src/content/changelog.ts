export type ChangeTag = "Platform" | "UI" | "Security" | "Compilers";

export type Release = { date: string; title: string; tags: ChangeTag[]; changes: string[] };

/** Newest first. Written for students and staff, from the merged changes on GitHub. */
export const RELEASES: Release[] = [
  {
    date: "2026-11-22",
    title: "Pear and Rich Black",
    tags: ["UI"],
    changes: [
      "Fresh brand palette: Pear accent on Rich Black, with Laurel Leaf, Celeste and Ceiling White neutrals in light and dark themes.",
    ],
  },
  {
    date: "2026-11-19",
    title: "A calmer look, and a new licence",
    tags: ["UI", "Platform"],
    changes: [
      "A softer teal palette in light and dark themes, with a simpler home page.",
      "AetherCode is now proprietary software, licensed to colleges. Earlier versions stay available under their original licence to those who already received them.",
    ],
  },
  {
    date: "2026-10-28",
    title: "A new look, and clearer privacy controls",
    tags: ["UI", "Security"],
    changes: [
      "Fresh design in light and dark themes, with a theme switch in your account menu.",
      "Cookie settings: analytics only load after you say yes, and exam IDs are removed from page addresses first.",
      "Public help, status, security, privacy and terms pages.",
    ],
  },
  {
    date: "2026-10-27",
    title: "Safer exam lockdown",
    tags: ["Security"],
    changes: [
      "Safe Exam Browser launch passwords must be long and random; weak ones are refused at start-up.",
      "Code-scanning findings fixed across the web app and services.",
    ],
  },
  {
    date: "2026-10-23",
    title: "Execution engine and editor fixes",
    tags: ["Compilers", "UI"],
    changes: [
      "Judge now runs on the AetherCode Execution Engine.",
      "Fixed the code editor failing to load in some deployments.",
      "A round of security hardening across services.",
    ],
  },
  {
    date: "2026-10-22",
    title: "Placements, profiles and results export",
    tags: ["Platform", "UI"],
    changes: [
      "Placement officers can filter candidates and export the list.",
      "Student profiles, resume page and progress tracking.",
      "Exam results export for staff.",
    ],
  },
  {
    date: "2026-10-05",
    title: "Exams locked to Safe Exam Browser",
    tags: ["Security", "Platform"],
    changes: [
      "Exams can require Safe Exam Browser, with every request's key checked against its exact URL.",
      "The server keeps each student's timer and submits automatically when time is up.",
      "Run code against the sample tests before you submit.",
      "AetherCode was released for colleges to run on their own servers.",
    ],
  },
  {
    date: "2026-10-04",
    title: "Grading end to end",
    tags: ["Compilers", "Platform"],
    changes: [
      "Submissions are graded against weighted test cases, with scores per question.",
      "C, C++17, Java, Python 3, JavaScript and Go enabled in the judge.",
    ],
  },
];
