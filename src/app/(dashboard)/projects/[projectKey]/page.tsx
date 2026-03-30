import { redirect } from "next/navigation";

export default function ProjectPage({ params }: { params: { projectKey: string } }) {
  redirect(`/projects/${params.projectKey}/board`);
}
