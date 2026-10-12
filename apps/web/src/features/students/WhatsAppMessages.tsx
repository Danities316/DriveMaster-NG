import { useState } from "react";
import type { StudentWithBalance, StudentTrainingSummary } from "@drivemaster/shared";

function whatsappNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("234")) return digits;
  if (digits.startsWith("0")) return `234${digits.slice(1)}`;
  return digits;
}

function openWhatsApp(phone: string, message: string): void {
  window.open(
    `https://wa.me/${whatsappNumber(phone)}?text=${encodeURIComponent(message)}`,
    "_blank",
    "noopener,noreferrer"
  );
}

export function WhatsAppMessages({
  student,
  summary
}: {
  student: StudentWithBalance;
  summary?: StudentTrainingSummary;
}) {
  const [open, setOpen] = useState(false);
  const firstName = student.name.trim().split(/\s+/)[0] || "there";
  const messages = [
    {
      label: "Payment reminder",
      text: `Hello ${firstName}, your remaining driving school balance is ₦${student.balanceRemaining}. Please contact the office if you have already made payment. Thank you.`
    },
    ...(summary
      ? [
          {
            label: "Training progress",
            text: `Hello ${firstName}, you have completed ${summary.confirmed} of ${summary.sessions} driving lessons. ${summary.remaining > 0 ? `${summary.remaining} lessons remain in your package.` : "Your package lessons are complete."} Please contact the school if you have any questions.`
          }
        ]
      : []),
    {
      label: "Lesson confirmation",
      text: `Hello ${firstName}, please confirm that your driving lesson took place. Reply to the school if there was any problem. Thank you.`
    }
  ];
  return (
    <div className="whatsapp-messages">
      <button type="button" className="dm-secondary" onClick={() => setOpen((value) => !value)}>
        {open ? "Close WhatsApp messages" : "Message on WhatsApp"}
      </button>
      {open ? (
        <div className="whatsapp-message-list" aria-label="Prepared WhatsApp messages">
          <p className="text-sm text-slate-600">Review the message before WhatsApp opens.</p>
          {messages.map((message) => (
            <button
              key={message.label}
              type="button"
              className="whatsapp-message-option"
              onClick={() => openWhatsApp(student.phone, message.text)}
            >
              <strong>{message.label}</strong>
              <span>{message.text}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
