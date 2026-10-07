import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { MetricCard } from "@/components/ui/metric-card";
import { EmptyState } from "@/components/ui/empty-state";
import { MetaChip } from "@/components/ui/badge";
import {
  FolderKanban,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
} from "lucide-react";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { buildAttentionItems, type AttentionIssue } from "@/lib/dashboard";

async function getUserProjects(userId: string) {
  return prisma.project.findMany({
    where: {
      members: { some: { userId } },
      isClosed: false,
    },
    include: {
      _count: { select: { members: true, issues: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

async function getAssignedIssues(userId: string) {
  return prisma.issue.findMany({
    where: {
      assigneeId: userId,
      projectStatus: { category: { not: "DONE" } },
      project: { isClosed: false },
    },
    include: {
      project: { select: { key: true, name: true } },
      projectStatus: { select: { id: true, name: true, category: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 5,
  });
}

async function getUpcomingDueDates(userId: string) {
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // next 7 days
  return prisma.issue.findMany({
    where: {
      project: { members: { some: { userId } }, isClosed: false },
      projectStatus: { category: { not: "DONE" } },
      dueDate: { not: null, lte: soon },
    },
    include: { project: { select: { key: true, name: true } } },
    orderBy: { dueDate: "asc" },
    take: 5,
  });
}

async function getRecentActivity(userId: string) {
  return prisma.activityLog.findMany({
    where: {
      issue: {
        project: {
          members: { some: { userId } },
          isClosed: false,
        },
      },
    },
    include: {
      user: { select: { id: true, name: true } },
      issue: { select: { key: true, title: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
}

async function getRecentDocs(userId: string) {
  return prisma.docPage.findMany({
    where: {
      docSpace: { project: { members: { some: { userId } }, isClosed: false } },
    },
    include: {
      docSpace: { select: { project: { select: { key: true, name: true } } } },
      author: { select: { id: true, name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 5,
  });
}

async function getAssignedCount(userId: string) {
  return prisma.issue.count({
    where: {
      assigneeId: userId,
      projectStatus: { category: { not: "DONE" } },
      project: { isClosed: false },
    },
  });
}

async function getDueSoonCount(userId: string) {
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return prisma.issue.count({
    where: {
      project: { members: { some: { userId } }, isClosed: false },
      projectStatus: { category: { not: "DONE" } },
      dueDate: { not: null, lte: soon },
    },
  });
}

async function getOpenIssuesCount(userId: string) {
  return prisma.issue.count({
    where: {
      project: { members: { some: { userId } }, isClosed: false },
      projectStatus: { category: { not: "DONE" } },
    },
  });
}

const priorityLabel: Record<"CRITICAL" | "HIGH" | "MEDIUM" | "LOW", string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export default async function DashboardPage() {
  const session = await requireUser();
  const userId = session.user.id;

  const [
    projects,
    assignedIssues,
    upcomingDueDates,
    recentActivity,
    recentDocs,
    assignedCount,
    dueSoonCount,
    openIssuesCount,
  ] = await Promise.all([
    getUserProjects(userId),
    getAssignedIssues(userId),
    getUpcomingDueDates(userId),
    getRecentActivity(userId),
    getRecentDocs(userId),
    getAssignedCount(userId),
    getDueSoonCount(userId),
    getOpenIssuesCount(userId),
  ]);

  const firstName = session.user.name?.split(" ")[0] ?? "there";

  const attentionItems: AttentionIssue[] = buildAttentionItems(assignedIssues, upcomingDueDates).slice(0, 5);
  const now = new Date();

  return (
    <div className="space-y-6 sm:space-y-8 max-w-6xl">
      <PageHeader
        eyebrow={format(now, "EEEE, MMMM d")}
        title={`Welcome back, ${firstName}`}
        subtitle="Here's what needs your attention today."
      />

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Active projects" value={projects.length} icon={FolderKanban} />
        <MetricCard label="Assigned to you" value={assignedCount} icon={Clock} />
        <MetricCard label="Due soon / overdue" value={dueSoonCount} icon={AlertCircle} />
        <MetricCard label="Total open work" value={openIssuesCount} icon={CheckCircle2} />
      </div>

      {/* Needs your attention */}
      <Card className="bg-surface shadow-[var(--shadow-panel)]">
        <CardHeader className="pb-3 flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold text-foreground">Needs your attention</CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">Prioritized by urgency and blockers</p>
          </div>
          <Link href="/search" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </CardHeader>
        <CardContent className="space-y-1">
          {attentionItems.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Nothing needs your attention"
              message="Issues assigned to you or due soon will show up here."
            />
          ) : (
            attentionItems.map((issue) => {
              const isOverdue = issue.dueDate ? new Date(issue.dueDate) < now : false;
              return (
                <Link
                  key={issue.id}
                  href={`/projects/${issue.project.key}/issues/${issue.key}`}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-surface-active transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate group-hover:text-primary">{issue.title}</p>
                    <span className="text-xs text-muted-foreground">
                      {issue.project.key}-{issue.key.split("-")[1]}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 ml-3 flex-shrink-0">
                    <MetaChip priority={issue.priority} label={priorityLabel[issue.priority]} />
                    {issue.dueDate && (
                      <span
                        className={`text-xs font-medium whitespace-nowrap flex items-center gap-1 ${
                          isOverdue ? "text-danger" : "text-warning"
                        }`}
                      >
                        {isOverdue && <AlertCircle className="w-3 h-3" />}
                        {isOverdue
                          ? "Overdue"
                          : new Date(issue.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Your Projects */}
        <Card className="bg-surface shadow-[var(--shadow-panel)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-foreground">Your Projects</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {projects.length === 0 ? (
              <EmptyState
                icon={FolderKanban}
                title="No projects yet"
                message="Create a project to start tracking issues with your team."
                action={{ label: "Create your first project", href: "/projects" }}
              />
            ) : (
              projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.key}`}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-surface-active transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-primary flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-primary-foreground">{project.key.slice(0, 2)}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground group-hover:text-primary">{project.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {project._count.members} members · {project._count.issues} issues
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground">{project.key}</span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card className="bg-surface shadow-[var(--shadow-panel)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-foreground">Recent Activity</CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">Useful changes, without the noise</p>
          </CardHeader>
          <CardContent>
            <ActivityFeed entries={recentActivity} showIssue />
          </CardContent>
        </Card>
      </div>

      {/* Recent docs */}
      <Card className="bg-surface shadow-[var(--shadow-panel)]">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-foreground">Recent Docs</CardTitle>
          <p className="text-sm text-muted-foreground mt-0.5">Continue where you left off</p>
        </CardHeader>
        <CardContent className="space-y-1">
          {recentDocs.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No docs yet"
              message="Documentation your team writes will show up here."
            />
          ) : (
            recentDocs.map((doc) => (
              <Link
                key={doc.id}
                href={`/projects/${doc.docSpace.project.key.toLowerCase()}/docs/${doc.id}`}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-surface-active transition-colors group"
              >
                <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate group-hover:text-primary">
                    {doc.title}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {doc.docSpace.project.name} · edited by {doc.author.name}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {formatDistanceToNow(new Date(doc.updatedAt), { addSuffix: true })}
                </span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
