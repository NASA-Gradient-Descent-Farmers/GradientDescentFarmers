// A WhatsApp-style mark (speech bubble with a handset) drawn inline, so the simulator needs no image file or network
// request. It is decorative: the chat's own text already says this is a simulation.

export function WhatsAppMark({ size = 24 }: { size?: number }) {
  return (
    <svg className="wa-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="16" fill="#25d366" />
      <path d="M16 6.2a9.8 9.8 0 0 0-8.4 14.8L6.2 25.8l5-1.3A9.8 9.8 0 1 0 16 6.2z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      <path
        d="M12.3 11.2c.3-.4.7-.4 1-.1l1.1 1.6c.2.3.2.6 0 .9l-.6.8c.7 1.4 1.8 2.5 3.3 3.2l.8-.7c.3-.3.6-.3.9-.1l1.6 1.1c.4.3.4.7.1 1.1-.7 1-2 1.4-3.2 1-2.8-1-5-3.2-5.9-6-.4-1.2 0-2.4.9-3.5z"
        fill="#fff"
      />
    </svg>
  )
}
