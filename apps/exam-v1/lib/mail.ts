import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  if (!host) throw new Error("SMTP_HOST is required for password reset emails");
  const port = Number(process.env.SMTP_PORT ?? 587);
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
      : undefined,
    tls: { rejectUnauthorized: false },
  });
  return transporter;
}

export async function sendMail(options: { to: string; subject: string; html: string }): Promise<void> {
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "noreply@localhost";
  await getTransporter().sendMail({ from, ...options });
}
