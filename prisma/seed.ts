import { PrismaClient, UserRole, ProjectMemberRole, IssueStatus, IssuePriority, IssueType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Create users
  const adminPassword = await bcrypt.hash("password123", 12);
  const memberPassword = await bcrypt.hash("password123", 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@taskforge.dev" },
    update: {},
    create: {
      name: "Alex Admin",
      email: "admin@taskforge.dev",
      passwordHash: adminPassword,
      role: UserRole.ADMIN,
      avatarUrl: null,
    },
  });

  const member = await prisma.user.upsert({
    where: { email: "member@taskforge.dev" },
    update: {},
    create: {
      name: "Morgan Member",
      email: "member@taskforge.dev",
      passwordHash: memberPassword,
      role: UserRole.MEMBER,
      avatarUrl: null,
    },
  });

  console.log("Created users:", admin.email, member.email);

  // Create projects
  const tfProject = await prisma.project.upsert({
    where: { key: "TF" },
    update: {},
    create: {
      name: "TaskForge",
      key: "TF",
      description: "The main TaskForge project management application",
    },
  });

  const spProject = await prisma.project.upsert({
    where: { key: "SP" },
    update: {},
    create: {
      name: "Side Project",
      key: "SP",
      description: "A personal side project for experiments and learning",
    },
  });

  console.log("Created projects:", tfProject.key, spProject.key);

  // Create project members
  await prisma.projectMember.upsert({
    where: { userId_projectId: { userId: admin.id, projectId: tfProject.id } },
    update: {},
    create: { userId: admin.id, projectId: tfProject.id, role: ProjectMemberRole.OWNER },
  });

  await prisma.projectMember.upsert({
    where: { userId_projectId: { userId: member.id, projectId: tfProject.id } },
    update: {},
    create: { userId: member.id, projectId: tfProject.id, role: ProjectMemberRole.MEMBER },
  });

  await prisma.projectMember.upsert({
    where: { userId_projectId: { userId: admin.id, projectId: spProject.id } },
    update: {},
    create: { userId: admin.id, projectId: spProject.id, role: ProjectMemberRole.OWNER },
  });

  await prisma.projectMember.upsert({
    where: { userId_projectId: { userId: member.id, projectId: spProject.id } },
    update: {},
    create: { userId: member.id, projectId: spProject.id, role: ProjectMemberRole.ADMIN },
  });

  // Create boards
  const tfBoard = await prisma.board.upsert({
    where: { id: "tf-default-board" },
    update: {},
    create: {
      id: "tf-default-board",
      projectId: tfProject.id,
      name: "Main Board",
    },
  });

  const spBoard = await prisma.board.upsert({
    where: { id: "sp-default-board" },
    update: {},
    create: {
      id: "sp-default-board",
      projectId: spProject.id,
      name: "Main Board",
    },
  });

  // Create columns for TF board
  const tfColumns = [
    { name: "To Do", position: 0, color: "#94a3b8" },
    { name: "In Progress", position: 1, color: "#818cf8" },
    { name: "In Review", position: 2, color: "#f59e0b" },
    { name: "Done", position: 3, color: "#10b981" },
  ];

  for (const col of tfColumns) {
    await prisma.column.create({
      data: { boardId: tfBoard.id, ...col },
    });
  }

  const spColumns = [
    { name: "To Do", position: 0, color: "#94a3b8" },
    { name: "In Progress", position: 1, color: "#818cf8" },
    { name: "In Review", position: 2, color: "#f59e0b" },
    { name: "Done", position: 3, color: "#10b981" },
  ];

  for (const col of spColumns) {
    await prisma.column.create({
      data: { boardId: spBoard.id, ...col },
    });
  }

  console.log("Created boards and columns");

  // Create issues for TF project
  const tfIssues = [
    {
      key: "TF-1",
      title: "Set up project infrastructure",
      description: "Initialize Next.js, Prisma, and configure all dependencies",
      status: IssueStatus.DONE,
      priority: IssuePriority.HIGH,
      type: IssueType.TASK,
      assigneeId: admin.id,
      reporterId: admin.id,
      position: 0,
    },
    {
      key: "TF-2",
      title: "Implement user authentication",
      description: "Add login, register, and session management with NextAuth.js",
      status: IssueStatus.IN_PROGRESS,
      priority: IssuePriority.CRITICAL,
      type: IssueType.STORY,
      assigneeId: member.id,
      reporterId: admin.id,
      position: 1,
    },
    {
      key: "TF-3",
      title: "Design kanban board UI",
      description: "Create drag-and-drop board with columns and issue cards",
      status: IssueStatus.TODO,
      priority: IssuePriority.HIGH,
      type: IssueType.STORY,
      assigneeId: admin.id,
      reporterId: admin.id,
      position: 2,
    },
    {
      key: "TF-4",
      title: "Fix login redirect bug",
      description: "After login, users are sometimes redirected to /undefined instead of the dashboard",
      status: IssueStatus.IN_REVIEW,
      priority: IssuePriority.CRITICAL,
      type: IssueType.BUG,
      assigneeId: member.id,
      reporterId: member.id,
      position: 3,
      labels: ["bug", "auth"],
    },
    {
      key: "TF-5",
      title: "Add issue search and filtering",
      description: "Allow users to search issues by title and filter by status, priority, assignee",
      status: IssueStatus.TODO,
      priority: IssuePriority.MEDIUM,
      type: IssueType.STORY,
      assigneeId: null,
      reporterId: admin.id,
      position: 4,
    },
    {
      key: "TF-6",
      title: "Real-time activity feed via SSE",
      description: "Stream activity updates to connected clients using Server-Sent Events",
      status: IssueStatus.TODO,
      priority: IssuePriority.LOW,
      type: IssueType.EPIC,
      assigneeId: null,
      reporterId: admin.id,
      position: 5,
    },
  ];

  for (const issue of tfIssues) {
    await prisma.issue.upsert({
      where: { key: issue.key },
      update: {},
      create: { ...issue, projectId: tfProject.id },
    });
  }

  // Create issues for SP project
  const spIssues = [
    {
      key: "SP-1",
      title: "Portfolio website redesign",
      description: "Modernize the portfolio site with new tech stack",
      status: IssueStatus.IN_PROGRESS,
      priority: IssuePriority.HIGH,
      type: IssueType.EPIC,
      assigneeId: admin.id,
      reporterId: admin.id,
      position: 0,
    },
    {
      key: "SP-2",
      title: "Add dark mode support",
      description: "Implement theme toggle with system preference detection",
      status: IssueStatus.TODO,
      priority: IssuePriority.MEDIUM,
      type: IssueType.TASK,
      assigneeId: member.id,
      reporterId: admin.id,
      position: 1,
    },
    {
      key: "SP-3",
      title: "Performance audit",
      description: "Run Lighthouse audit and fix any issues below 90 score",
      status: IssueStatus.TODO,
      priority: IssuePriority.LOW,
      type: IssueType.TASK,
      assigneeId: null,
      reporterId: member.id,
      position: 2,
    },
    {
      key: "SP-4",
      title: "Mobile responsiveness bug on iOS",
      description: "Navigation menu overflows on iPhone SE screen size",
      status: IssueStatus.IN_REVIEW,
      priority: IssuePriority.HIGH,
      type: IssueType.BUG,
      assigneeId: member.id,
      reporterId: member.id,
      position: 3,
      labels: ["bug", "mobile"],
    },
  ];

  for (const issue of spIssues) {
    await prisma.issue.upsert({
      where: { key: issue.key },
      update: {},
      create: { ...issue, projectId: spProject.id },
    });
  }

  console.log("Created 10 issues across both projects");
  console.log("Seeding complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
