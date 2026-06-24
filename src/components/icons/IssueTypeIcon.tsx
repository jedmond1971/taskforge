import { IssueType } from "@prisma/client";

function BugIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#E5534B" fillOpacity="0.18" />
      <circle cx="12" cy="12" r="8" fill="#E5534B" />
      <path d="M9 9L15 15M15 9L9 15" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function TaskIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#4B9EE5" fillOpacity="0.18" />
      <circle cx="12" cy="12" r="8" fill="#4B9EE5" />
      <path d="M7.5 12L10.5 15L16.5 9" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#4BAE8A" fillOpacity="0.18" />
      <circle cx="12" cy="12" r="8" fill="#4BAE8A" />
      <path d="M8.5 6.5L13.5 6.5L15.5 8.5L15.5 17L8.5 17Z" fill="white" />
      <path d="M13.5 6.5L13.5 8.5L15.5 8.5Z" fill="#4BAE8A" fillOpacity="0.45" />
      <line x1="10" y1="10.5" x2="14" y2="10.5" stroke="#4BAE8A" strokeWidth="1" strokeLinecap="round" />
      <line x1="10" y1="12.5" x2="14" y2="12.5" stroke="#4BAE8A" strokeWidth="1" strokeLinecap="round" />
      <line x1="10" y1="14.5" x2="12.5" y2="14.5" stroke="#4BAE8A" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function EpicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#9B59D0" fillOpacity="0.18" />
      <circle cx="12" cy="12" r="8" fill="#9B59D0" />
      <path d="M12 6L18 12L12 18L6 12L12 6Z" fill="white" />
    </svg>
  );
}

const ICONS: Record<IssueType, () => JSX.Element> = {
  BUG: BugIcon,
  TASK: TaskIcon,
  STORY: StoryIcon,
  EPIC: EpicIcon,
};

export function IssueTypeIcon({ type }: { type: IssueType }) {
  const Icon = ICONS[type];
  return Icon ? <Icon /> : null;
}
