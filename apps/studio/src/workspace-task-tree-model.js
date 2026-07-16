function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function sessionProjectId(session) {
  const value = session?.metadata?.local_project_id;
  return typeof value === "string" ? value : "";
}

function missionSearchText(mission) {
  return [
    mission?.title,
    mission?.status,
    mission?.mission_view?.title,
    mission?.mission_view?.summary,
    mission?.mission_view?.statusLabel,
    mission?.mission_view?.nextActionLabel,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function groupWorkspaceTasks({ projects, missions, sessions, query = "" }) {
  const activeProjects = (Array.isArray(projects) ? projects : []).filter((project) => !project?.archived);
  const taskItems = Array.isArray(missions) ? missions : [];
  const sessionItems = Array.isArray(sessions) ? sessions : [];
  const normalizedQuery = normalized(query);
  const projectIdBySession = new Map(
    sessionItems.map((session) => [session.session_id, sessionProjectId(session)]),
  );
  const registeredProjectIds = new Set(
    activeProjects.map((project) => project.registeredProjectId).filter(Boolean),
  );
  const groups = activeProjects.flatMap((project) => {
    const projectTasks = taskItems.filter(
      (mission) => projectIdBySession.get(mission.session_id) === project.registeredProjectId,
    );
    const projectMatches = [project.name, project.rootPath, project.description]
      .filter(Boolean)
      .some((value) => normalized(value).includes(normalizedQuery));
    const visibleTasks = normalizedQuery && !projectMatches
      ? projectTasks.filter((mission) => missionSearchText(mission).includes(normalizedQuery))
      : projectTasks;
    if (normalizedQuery && !projectMatches && !visibleTasks.length) return [];
    return [{ project, tasks: visibleTasks }];
  });
  const unassigned = taskItems.filter((mission) => {
    const projectId = projectIdBySession.get(mission.session_id) || "";
    const isUnassigned = !projectId || !registeredProjectIds.has(projectId);
    return isUnassigned && (!normalizedQuery || missionSearchText(mission).includes(normalizedQuery));
  });
  return { groups, unassigned };
}

export function reassignSessionProjectMetadata(session, taskWorkspace) {
  if (!session || !taskWorkspace) return session;
  return {
    ...session,
    metadata: {
      ...(session.metadata || {}),
      local_project_id: taskWorkspace.project?.project_id || "",
      task_workspace_id: taskWorkspace.task_workspace_id,
      task_output_relative_path: taskWorkspace.output_relative_path,
    },
  };
}
