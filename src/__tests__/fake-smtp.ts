/**
 * A fake SMTP wire for tests. nodemailer's own mailer, message composer and
 * address parser run exactly as they do before an SMTP send; only the last
 * step is replaced: the finished RFC 822 message is kept in memory instead of
 * going to a server. No network.
 *
 * Pass the nodemailer module object the code under test calls: the ESM
 * default export (`import nodemailer from "nodemailer"`, the app's routes) or
 * the CommonJS exports (`require("nodemailer")`, next-auth's Email provider).
 */
import { vi } from "vitest";

export interface SentMail {
  /** What the code under test passed to createTransport (host, port, auth). */
  smtp: unknown;
  envelope: { from: string | false; to: string[] };
  /** The whole message as nodemailer built it: headers and encoded parts. */
  raw: string;
  /** The plain-text part before transfer encoding. */
  text: string;
}

interface Mail {
  data: { text?: unknown };
  message: {
    getEnvelope(): { from: string | false; to: string[] };
    messageId(): string;
    build(callback: (err: Error | null, raw: Buffer) => void): void;
  };
}

type Done = (err: Error | null, info?: unknown) => void;
type Nodemailer = { createTransport: (transport: unknown) => unknown };

export function fakeSmtp(nodemailerModule: object) {
  const mod = nodemailerModule as Nodemailer;
  const realCreateTransport = mod.createTransport;
  const sent: SentMail[] = [];

  const spy = vi.spyOn(mod, "createTransport").mockImplementation((smtp: unknown) =>
    realCreateTransport({
      name: "fake-smtp",
      version: "1.0.0",
      send(mail: Mail, done: Done) {
        const envelope = mail.message.getEnvelope();
        const messageId = mail.message.messageId();
        mail.message.build((err, raw) => {
          if (err) return done(err);
          sent.push({ smtp, envelope, raw: raw.toString(), text: String(mail.data.text ?? "") });
          // The fields nodemailer's SMTP transport resolves with.
          done(null, { envelope, messageId, accepted: envelope.to, rejected: [], response: "250 2.0.0 queued" });
        });
      },
    }),
  );

  return { sent, spy };
}
