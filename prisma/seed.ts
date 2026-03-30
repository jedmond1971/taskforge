import { PrismaClient, IssueStatus, IssuePriority, IssueType, UserRole, ProjectMemberRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // Cleanup
  await prisma.activityLog.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.issue.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.column.deleteMany();
  await prisma.board.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();

  // Users
  const hashedPassword = await bcrypt.hash("password123", 12);

  const alice = await prisma.user.create({
    data: { email: "admin@taskforge.dev", name: "Alice Chen", passwordHash: hashedPassword, role: UserRole.ADMIN },
  });
  const bob = await prisma.user.create({
    data: { email: "member@taskforge.dev", name: "Bob Martinez", passwordHash: hashedPassword, role: UserRole.MEMBER },
  });
  const carol = await prisma.user.create({
    data: { email: "carol@taskforge.dev", name: "Carol Singh", passwordHash: hashedPassword, role: UserRole.MEMBER },
  });
  const dave = await prisma.user.create({
    data: { email: "dave@taskforge.dev", name: "Dave Kim", passwordHash: hashedPassword, role: UserRole.MEMBER },
  });

  // Project 1: Product Launch
  const pl = await prisma.project.create({
    data: {
      name: "Product Launch",
      key: "PL",
      description: "Q2 product launch coordination — features, marketing, and release readiness",
    },
  });
  await prisma.projectMember.createMany({
    data: [
      { userId: alice.id, projectId: pl.id, role: ProjectMemberRole.OWNER },
      { userId: bob.id, projectId: pl.id, role: ProjectMemberRole.MEMBER },
      { userId: carol.id, projectId: pl.id, role: ProjectMemberRole.MEMBER },
    ],
  });

  // Project 2: Mobile App
  const ma = await prisma.project.create({
    data: {
      name: "Mobile App",
      key: "MA",
      description: "Native mobile app for iOS and Android — React Native rewrite",
    },
  });
  await prisma.projectMember.createMany({
    data: [
      { userId: alice.id, projectId: ma.id, role: ProjectMemberRole.OWNER },
      { userId: bob.id, projectId: ma.id, role: ProjectMemberRole.MEMBER },
      { userId: dave.id, projectId: ma.id, role: ProjectMemberRole.MEMBER },
    ],
  });

  // Project 3: Website Redesign
  const wr = await prisma.project.create({
    data: {
      name: "Website Redesign",
      key: "WR",
      description: "Full redesign of marketing site with new brand guidelines",
    },
  });
  await prisma.projectMember.createMany({
    data: [
      { userId: alice.id, projectId: wr.id, role: ProjectMemberRole.OWNER },
      { userId: carol.id, projectId: wr.id, role: ProjectMemberRole.MEMBER },
      { userId: dave.id, projectId: wr.id, role: ProjectMemberRole.MEMBER },
    ],
  });

  // Helper to create a default board + 4 columns for a project
  async function createBoard(projectId: string) {
    const board = await prisma.board.create({ data: { projectId, name: "Main Board" } });
    await prisma.column.createMany({
      data: [
        { boardId: board.id, name: "To Do",       position: 0, color: "#94a3b8" },
        { boardId: board.id, name: "In Progress",  position: 1, color: "#60a5fa" },
        { boardId: board.id, name: "In Review",    position: 2, color: "#fbbf24" },
        { boardId: board.id, name: "Done",         position: 3, color: "#34d399" },
      ],
    });
  }

  await createBoard(pl.id);
  await createBoard(ma.id);
  await createBoard(wr.id);

  // Helper to create issues with incrementing keys
  let plCount = 0, maCount = 0, wrCount = 0;
  function nextKey(project: typeof pl) {
    if (project.key === "PL") return `PL-${++plCount}`;
    if (project.key === "MA") return `MA-${++maCount}`;
    return `WR-${++wrCount}`;
  }

  // ---- PRODUCT LAUNCH ISSUES ----
  const plIssues = await Promise.all([
    prisma.issue.create({ data: { key: nextKey(pl), projectId: pl.id, title: "Define Q2 launch timeline and milestones", description: "Work with stakeholders to establish key dates: beta, soft launch, and public launch. Include buffer for QA and marketing review.", status: IssueStatus.DONE, priority: IssuePriority.HIGH, type: IssueType.TASK, reporterId: alice.id, assigneeId: alice.id, labels: ["planning", "milestone"], position: 0 } }),
    prisma.issue.create({ data: { key: nextKey(pl), projectId: pl.id, title: "Write feature announcement blog post", description: "Draft a compelling blog post covering the 3 headline features. Needs SEO review and legal sign-off before publishing.", status: IssueStatus.IN_PROGRESS, priority: IssuePriority.HIGH, type: IssueType.TASK, reporterId: alice.id, assigneeId: carol.id, labels: ["marketing", "content"], position: 0 } }),
    prisma.issue.create({ data: { key: nextKey(pl), projectId: pl.id, title: "Set up launch day monitoring dashboard", description: "Configure Datadog dashboards for error rate, latency p99, and active users. Set up PagerDuty alerts for launch window.", status: IssueStatus.TODO, priority: IssuePriority.CRITICAL, type: IssueType.TASK, reporterId: bob.id, assigneeId: bob.id, labels: ["infrastructure", "monitoring"], position: 0 } }),
    prisma.issue.create({ data: { key: nextKey(pl), projectId: pl.id, title: "Onboarding flow crashes on Android 12", description: "Reproducible crash during email verification step on Android 12 devices. Stack trace points to deep link handling. Affects ~8% of beta users.", status: IssueStatus.IN_PROGRESS, priority: IssuePriority.CRITICAL, type: IssueType.BUG, reporterId: bob.id, assigneeId: bob.id, labels: ["bug", "android", "critical"], position: 1 } }),
    prisma.issue.create({ data: { key: nextKey(pl), projectId: pl.id, title: "Prepare press kit and media assets", description: "Create ZIP with logo variants, product screenshots (light/dark), founder headshots, and one-pager PDF.", status: IssueStatus.TODO, priority: IssuePriority.MEDIUM, type: IssueType.TASK, reporterId: alice.id, assigneeId: carol.id, labels: ["marketing"], position: 1 } }),
    prisma.issue.create({ data: { key: nextKey(pl), projectId: pl.id, title: "Load test API for 10k concurrent users", description: "Run k6 load test against staging. Target: p99 < 300ms at 10k RPS. Fix any bottlenecks identified before launch.", status: IssueStatus.IN_REVIEW, priority: IssuePriority.HIGH, type: IssueType.TASK, reporterId: bob.id, assigneeId: bob.id, labels: ["performance", "infrastructure"], position: 0 } }),
    prisma.issue.create({ data: { key: nextKey(pl), projectId: pl.id, title: "Update pricing page with new tier structure", description: "New tiers: Starter ($0), Pro ($29/mo), Enterprise (contact). Need to update feature comparison table and FAQ.", status: IssueStatus.DONE, priority: IssuePriority.HIGH, type: IssueType.STORY, reporterId: alice.id, assigneeId: carol.id, labels: ["marketing", "website"], position: 1 } }),
    prisma.issue.create({ data: { key: nextKey(pl), projectId: pl.id, title: "Email notification for failed payment", description: "Users should receive an email when their subscription payment fails, with a direct link to update billing details.", status: IssueStatus.TODO, priority: IssuePriority.MEDIUM, type: IssueType.STORY, reporterId: alice.id, assigneeId: null, labels: ["billing", "email"], position: 2 } }),
    prisma.issue.create({ data: { key: nextKey(pl), projectId: pl.id, title: "GDPR data export feature", description: "Users must be able to request a full export of their data. Must be generated async and delivered via email within 24h.", status: IssueStatus.TODO, priority: IssuePriority.HIGH, type: IssueType.STORY, reporterId: alice.id, assigneeId: null, labels: ["compliance", "gdpr"], position: 3 } }),
  ]);

  // ---- MOBILE APP ISSUES ----
  const maIssues = await Promise.all([
    prisma.issue.create({ data: { key: nextKey(ma), projectId: ma.id, title: "Set up React Native project with Expo", description: "Bootstrap project with Expo SDK 50, configure TypeScript, set up ESLint and Prettier, add CI/CD pipeline.", status: IssueStatus.DONE, priority: IssuePriority.HIGH, type: IssueType.TASK, reporterId: alice.id, assigneeId: dave.id, labels: ["setup"], position: 0 } }),
    prisma.issue.create({ data: { key: nextKey(ma), projectId: ma.id, title: "Implement biometric authentication", description: "Use expo-local-authentication for Face ID / fingerprint login. Fallback to PIN if biometric unavailable.", status: IssueStatus.IN_PROGRESS, priority: IssuePriority.HIGH, type: IssueType.STORY, reporterId: alice.id, assigneeId: dave.id, labels: ["auth", "security"], position: 0 } }),
    prisma.issue.create({ data: { key: nextKey(ma), projectId: ma.id, title: "Push notification infrastructure", description: "Set up Expo push notifications. Implement token registration, notification preferences screen, and deep link routing.", status: IssueStatus.TODO, priority: IssuePriority.HIGH, type: IssueType.EPIC, reporterId: bob.id, assigneeId: bob.id, labels: ["notifications", "infrastructure"], position: 0 } }),
    prisma.issue.create({ data: { key: nextKey(ma), projectId: ma.id, title: "Offline mode for core features", description: "Cache issue list and board state with React Query + MMKV. Queue mutations when offline and sync on reconnect.", status: IssueStatus.TODO, priority: IssuePriority.MEDIUM, type: IssueType.EPIC, reporterId: alice.id, assigneeId: null, labels: ["offline", "performance"], position: 1 } }),
    prisma.issue.create({ data: { key: nextKey(ma), projectId: ma.id, title: "Dark mode flickers on initial load", description: "Theme preference loaded from AsyncStorage causes a white flash before dark mode applies. Need to use synchronous storage.", status: IssueStatus.IN_REVIEW, priority: IssuePriority.MEDIUM, type: IssueType.BUG, reporterId: dave.id, assigneeId: dave.id, labels: ["bug", "ui", "dark-mode"], position: 0 } }),
    prisma.issue.create({ data: { key: nextKey(ma), projectId: ma.id, title: "Design bottom tab navigation", description: "5 tabs: Home, Projects, Search, Notifications, Profile. Should match the web app's information architecture.", status: IssueStatus.DONE, priority: IssuePriority.HIGH, type: IssueType.TASK, reporterId: alice.id, assigneeId: dave.id, labels: ["navigation", "design"], position: 1 } }),
    prisma.issue.create({ data: { key: nextKey(ma), projectId: ma.id, title: "App Store listing copy and screenshots", description: "Write App Store / Play Store descriptions (short + long), prepare 6 screenshots per device size, create preview video.", status: IssueStatus.TODO, priority: IssuePriority.MEDIUM, type: IssueType.TASK, reporterId: alice.id, assigneeId: null, labels: ["marketing", "app-store"], position: 2 } }),
    prisma.issue.create({ data: { key: nextKey(ma), projectId: ma.id, title: "Implement swipe-to-complete gesture on issue cards", description: "Right swipe marks issue as done, left swipe opens quick-assign drawer. Use react-native-gesture-handler.", status: IssueStatus.IN_PROGRESS, priority: IssuePriority.LOW, type: IssueType.STORY, reporterId: bob.id, assigneeId: bob.id, labels: ["ux", "gesture"], position: 1 } }),
  ]);

  // ---- WEBSITE REDESIGN ISSUES ----
  const wrIssues = await Promise.all([
    prisma.issue.create({ data: { key: nextKey(wr), projectId: wr.id, title: "Finalize new brand color palette", description: "Choose primary, secondary, and neutral color tokens. Must pass WCAG AA contrast. Deliver as Figma library + CSS custom properties.", status: IssueStatus.DONE, priority: IssuePriority.HIGH, type: IssueType.TASK, reporterId: alice.id, assigneeId: carol.id, labels: ["design", "branding"], position: 0 } }),
    prisma.issue.create({ data: { key: nextKey(wr), projectId: wr.id, title: "Redesign homepage hero section", description: "New hero with animated product screenshot, social proof numbers (users, projects, teams), and two CTAs. Must load above-the-fold in < 1.5s LCP.", status: IssueStatus.IN_PROGRESS, priority: IssuePriority.HIGH, type: IssueType.STORY, reporterId: alice.id, assigneeId: carol.id, labels: ["design", "homepage"], position: 0 } }),
    prisma.issue.create({ data: { key: nextKey(wr), projectId: wr.id, title: "Implement component library in Storybook", description: "Document all reusable components: Button, Card, Badge, Input, Select, Modal, Toast. Include usage examples and prop tables.", status: IssueStatus.TODO, priority: IssuePriority.MEDIUM, type: IssueType.TASK, reporterId: dave.id, assigneeId: dave.id, labels: ["design-system", "documentation"], position: 0 } }),
    prisma.issue.create({ data: { key: nextKey(wr), projectId: wr.id, title: "Fix broken links in footer navigation", description: "Several footer links 404 after last deployment. Audit all 24 footer links and fix dead links before launch.", status: IssueStatus.DONE, priority: IssuePriority.LOW, type: IssueType.BUG, reporterId: carol.id, assigneeId: carol.id, labels: ["bug", "seo"], position: 1 } }),
    prisma.issue.create({ data: { key: nextKey(wr), projectId: wr.id, title: "SEO audit and meta tag improvements", description: "Run Lighthouse SEO audit. Fix missing meta descriptions, improve OG images (current size 200x200, need 1200x630), add JSON-LD schema.", status: IssueStatus.IN_REVIEW, priority: IssuePriority.HIGH, type: IssueType.TASK, reporterId: alice.id, assigneeId: dave.id, labels: ["seo", "performance"], position: 0 } }),
    prisma.issue.create({ data: { key: nextKey(wr), projectId: wr.id, title: "Add interactive pricing calculator", description: "Users enter team size and usage; calculator shows estimated monthly cost across tiers. Update real-time as inputs change.", status: IssueStatus.TODO, priority: IssuePriority.MEDIUM, type: IssueType.STORY, reporterId: alice.id, assigneeId: null, labels: ["pricing", "interactive"], position: 1 } }),
    prisma.issue.create({ data: { key: nextKey(wr), projectId: wr.id, title: "Migrate blog from WordPress to MDX", description: "Export all 47 posts from WordPress, convert to MDX format, set up syntax highlighting, maintain URL structure for SEO.", status: IssueStatus.IN_PROGRESS, priority: IssuePriority.MEDIUM, type: IssueType.EPIC, reporterId: carol.id, assigneeId: carol.id, labels: ["blog", "content"], position: 1 } }),
    prisma.issue.create({ data: { key: nextKey(wr), projectId: wr.id, title: "Performance: achieve 95+ Lighthouse score", description: "Current score: 72. Issues: render-blocking CSS, unoptimized images, missing preconnect hints. Target all four Lighthouse categories > 90.", status: IssueStatus.TODO, priority: IssuePriority.HIGH, type: IssueType.TASK, reporterId: dave.id, assigneeId: dave.id, labels: ["performance", "core-web-vitals"], position: 2 } }),
  ]);

  // Comments
  await prisma.comment.createMany({ data: [
    { issueId: plIssues[3].id, authorId: bob.id, body: "Reproduced on a Pixel 6 running Android 12. Doesn't happen on Android 13. Looks like the deep link intent handling changed between versions." },
    { issueId: plIssues[3].id, authorId: alice.id, body: "Good find. Can you check the AndroidManifest intent-filter? We may need to add the autoVerify attribute for Android 12+." },
    { issueId: plIssues[3].id, authorId: bob.id, body: "That was exactly it. Added autoVerify and the crash is gone in testing. Raising a PR now — should be merged by EOD." },
    { issueId: plIssues[5].id, authorId: bob.id, body: "Load test results: p50 = 45ms, p95 = 180ms, p99 = 520ms at 10k RPS. P99 is over budget. Bottleneck is the issues query — missing index on projectId + status." },
    { issueId: plIssues[5].id, authorId: alice.id, body: "Add a composite index (projectId, status, position). That query runs on every board load so it'll make a big difference." },
    { issueId: maIssues[4].id, authorId: dave.id, body: "Fixed by switching from AsyncStorage to react-native-mmkv for theme preference. Synchronous read means no flash. Ready for review." },
    { issueId: maIssues[4].id, authorId: bob.id, body: "Tested on iOS and Android. Looks good! One minor thing: the transition animation between light and dark is a bit abrupt. Could add a 150ms opacity fade?" },
    { issueId: wrIssues[1].id, authorId: carol.id, body: "First draft of the hero is ready in Figma. Headline is 'Ship faster. Stay aligned.' with the animated screenshot carousel. LCP measured at 1.3s on 4G." },
    { issueId: wrIssues[1].id, authorId: alice.id, body: "Love the headline. Can we A/B test it against 'Your team's command center'? Also, the CTA buttons need more contrast — failing AA on the dark background." },
    { issueId: wrIssues[4].id, authorId: dave.id, body: "SEO audit done. Fixed 18/24 issues. Remaining 6 are related to third-party scripts we can't easily remove. Lighthouse SEO score is now 97." },
  ]});

  // Activity logs
  const logs = [];
  // PL project activity
  logs.push({ issueId: plIssues[0].id, userId: alice.id, action: "created" });
  logs.push({ issueId: plIssues[0].id, userId: alice.id, action: "updated", field: "status", oldValue: "TODO", newValue: "IN_PROGRESS" });
  logs.push({ issueId: plIssues[0].id, userId: alice.id, action: "updated", field: "status", oldValue: "IN_PROGRESS", newValue: "DONE" });
  logs.push({ issueId: plIssues[1].id, userId: alice.id, action: "created" });
  logs.push({ issueId: plIssues[1].id, userId: alice.id, action: "updated", field: "assignee", oldValue: "", newValue: "Carol Singh" });
  logs.push({ issueId: plIssues[3].id, userId: bob.id, action: "created" });
  logs.push({ issueId: plIssues[3].id, userId: bob.id, action: "updated", field: "priority", oldValue: "HIGH", newValue: "CRITICAL" });
  logs.push({ issueId: plIssues[3].id, userId: bob.id, action: "commented" });
  logs.push({ issueId: plIssues[3].id, userId: alice.id, action: "commented" });
  logs.push({ issueId: plIssues[3].id, userId: bob.id, action: "commented" });
  logs.push({ issueId: plIssues[5].id, userId: bob.id, action: "created" });
  logs.push({ issueId: plIssues[5].id, userId: bob.id, action: "updated", field: "status", oldValue: "TODO", newValue: "IN_REVIEW" });
  logs.push({ issueId: plIssues[5].id, userId: bob.id, action: "commented" });
  logs.push({ issueId: plIssues[6].id, userId: carol.id, action: "created" });
  logs.push({ issueId: plIssues[6].id, userId: carol.id, action: "updated", field: "status", oldValue: "TODO", newValue: "DONE" });
  // MA project activity
  logs.push({ issueId: maIssues[0].id, userId: dave.id, action: "created" });
  logs.push({ issueId: maIssues[0].id, userId: dave.id, action: "updated", field: "status", oldValue: "TODO", newValue: "DONE" });
  logs.push({ issueId: maIssues[1].id, userId: alice.id, action: "created" });
  logs.push({ issueId: maIssues[1].id, userId: dave.id, action: "updated", field: "status", oldValue: "TODO", newValue: "IN_PROGRESS" });
  logs.push({ issueId: maIssues[4].id, userId: dave.id, action: "created" });
  logs.push({ issueId: maIssues[4].id, userId: dave.id, action: "commented" });
  logs.push({ issueId: maIssues[4].id, userId: bob.id, action: "commented" });
  logs.push({ issueId: maIssues[4].id, userId: dave.id, action: "updated", field: "status", oldValue: "IN_PROGRESS", newValue: "IN_REVIEW" });
  logs.push({ issueId: maIssues[5].id, userId: dave.id, action: "created" });
  logs.push({ issueId: maIssues[5].id, userId: dave.id, action: "updated", field: "status", oldValue: "TODO", newValue: "DONE" });
  // WR project activity
  logs.push({ issueId: wrIssues[0].id, userId: carol.id, action: "created" });
  logs.push({ issueId: wrIssues[0].id, userId: carol.id, action: "updated", field: "status", oldValue: "TODO", newValue: "DONE" });
  logs.push({ issueId: wrIssues[1].id, userId: alice.id, action: "created" });
  logs.push({ issueId: wrIssues[1].id, userId: carol.id, action: "updated", field: "status", oldValue: "TODO", newValue: "IN_PROGRESS" });
  logs.push({ issueId: wrIssues[1].id, userId: carol.id, action: "commented" });
  logs.push({ issueId: wrIssues[1].id, userId: alice.id, action: "commented" });
  logs.push({ issueId: wrIssues[3].id, userId: carol.id, action: "created" });
  logs.push({ issueId: wrIssues[3].id, userId: carol.id, action: "updated", field: "status", oldValue: "TODO", newValue: "DONE" });
  logs.push({ issueId: wrIssues[4].id, userId: dave.id, action: "created" });
  logs.push({ issueId: wrIssues[4].id, userId: dave.id, action: "updated", field: "status", oldValue: "TODO", newValue: "IN_REVIEW" });
  logs.push({ issueId: wrIssues[4].id, userId: dave.id, action: "commented" });

  await prisma.activityLog.createMany({ data: logs });

  console.log("Seed complete:");
  console.log(`   Users: 4 (admin@taskforge.dev, member@taskforge.dev, carol@taskforge.dev, dave@taskforge.dev)`);
  console.log(`   Projects: 3 (PL, MA, WR)`);
  console.log(`   Issues: ${plIssues.length + maIssues.length + wrIssues.length}`);
  console.log(`   Comments: 10`);
  console.log(`   Activity logs: ${logs.length}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
