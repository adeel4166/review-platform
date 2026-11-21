import nodemailer from "nodemailer";

/** Mail provider interface (ADR-0016 §3.5). Only the worker sends mail; the web app never holds SMTP credentials. */
export type MailTemplateId = "verify_account" | "account_exists";

export interface RenderedMail { to: string; subject: string; text: string; html: string }

export class MailTransientError extends Error {}

export interface MailProvider {
  /** Idempotent on idempotencyKey where the provider supports it. Throws MailTransientError to retry. */
  send(mail: RenderedMail, opts: { idempotencyKey: string }): Promise<{ providerMessageId: string }>;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** English-only templates (ADR-0009 key shape kept). `vars.url` must come from APP_URL, never the request Host. */
export function renderMail(template: MailTemplateId, to: string, vars: Record<string, string>): RenderedMail {
  const url = vars.url ?? "";
  switch (template) {
    case "verify_account":
      return {
        to,
        subject: "Confirm your email address",
        text: `Confirm your email to finish setting up your account (link valid for 24 hours):\n\n${url}\n\nIf you did not sign up, ignore this message.`,
        html: `<p>Confirm your email to finish setting up your account (link valid for 24 hours):</p><p><a href="${esc(url)}">Confirm email</a></p><p>If you did not sign up, ignore this message.</p>`,
      };
    case "account_exists":
      return {
        to,
        subject: "Someone tried to register with your email",
        text: `Someone tried to create an account with this email address, but an account already exists.\n\nSign in here: ${url}\n\nIf this was you, just sign in. If not, you can ignore this message.`,
        html: `<p>Someone tried to create an account with this email address, but an account already exists.</p><p><a href="${esc(url)}">Sign in</a></p><p>If this was not you, you can ignore this message.</p>`,
      };
  }
}

/** In-memory provider for unit/integration tests. Never prints mail (tokens) anywhere. */
export class FakeMailProvider implements MailProvider {
  readonly sent: Array<RenderedMail & { idempotencyKey: string }> = [];
  async send(mail: RenderedMail, opts: { idempotencyKey: string }) {
    if (!this.sent.some((m) => m.idempotencyKey === opts.idempotencyKey)) this.sent.push({ ...mail, idempotencyKey: opts.idempotencyKey });
    return { providerMessageId: `fake-${this.sent.length}` };
  }
}

/** SMTP provider: Mailpit in dev (plain, port 1025), a TLS relay in prod. */
export class SmtpMailProvider implements MailProvider {
  private transport;
  constructor(smtpUrl: string, private from: string) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }
  async send(mail: RenderedMail, opts: { idempotencyKey: string }) {
    try {
      const info = await this.transport.sendMail({ from: this.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html, headers: { "X-Idempotency-Key": opts.idempotencyKey } });
      return { providerMessageId: String(info.messageId) };
    } catch (e) {
      throw new MailTransientError(e instanceof Error ? e.message.slice(0, 200) : "smtp error");
    }
  }
}

export interface MailEnv { MAIL_PROVIDER?: string; SMTP_URL?: string; MAIL_FROM?: string; NODE_ENV?: string }

export function createMailProvider(env: MailEnv = process.env): MailProvider {
  const kind = env.MAIL_PROVIDER ?? "smtp";
  if (kind === "fake") {
    if (env.NODE_ENV === "production") throw new Error("MAIL_PROVIDER=fake is not allowed in production");
    return new FakeMailProvider();
  }
  if (kind !== "smtp") throw new Error(`Unknown MAIL_PROVIDER: ${kind}`);
  const url = env.SMTP_URL ?? (env.NODE_ENV === "production" ? undefined : "smtp://127.0.0.1:1025");
  if (!url) throw new Error("SMTP_URL is required in production");
  if (env.NODE_ENV === "production" && !/^smtps:/.test(url) && !/requireTLS=true/.test(url)) throw new Error("SMTP_URL must use TLS in production (smtps:// or ?requireTLS=true)");
  return new SmtpMailProvider(url, env.MAIL_FROM ?? "Review Platform <no-reply@localhost>");
}

/** Link base from config only (blocks host-header poisoning). */
export function appUrl(env: { APP_URL?: string; NODE_ENV?: string } = process.env): string {
  const u = env.APP_URL ?? (env.NODE_ENV === "production" ? undefined : "http://localhost:3000");
  if (!u) throw new Error("APP_URL is required in production");
  return u.replace(/\/+$/, "");
}
