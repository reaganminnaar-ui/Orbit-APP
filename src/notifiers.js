import nodemailer from "nodemailer";

export function formatAlert(alert) { return `[${alert.severity.toUpperCase()}] ${alert.type}: ${alert.title}\n${alert.details}\n${alert.occurredAt}`; }

export async function sendSlack(webhook, alert, fetchImpl = fetch) {
  if (!webhook) return;
  const response = await fetchImpl(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: formatAlert(alert) }) });
  if (!response.ok) throw new Error(`Slack delivery failed (${response.status})`);
}

export async function sendEmail(smtp, alert) {
  if (!smtp.host || !smtp.from || !smtp.to.length) return;
  const transport = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined, requireTLS: !smtp.secure });
  await transport.sendMail({ from: smtp.from, to: smtp.to, subject: `Orbit: ${alert.type} — ${alert.title}`.replace(/[\r\n]/g, " "), text: formatAlert(alert) });
}

export async function notify(config, alert) {
  const results = await Promise.allSettled([sendSlack(config.slackWebhookUrl, alert), sendEmail(config.smtp, alert)]);
  const failures = results.filter(r => r.status === "rejected");
  if (failures.length === results.length) throw new AggregateError(failures.map(f => f.reason), "All notification channels failed");
  failures.forEach(f => console.error(f.reason));
}
