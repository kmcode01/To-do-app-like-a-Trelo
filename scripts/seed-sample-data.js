import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const usersToSeed = [
  { email: 'kristiqn@abv.bg', password: '123456789', label: 'Kristiqn' },
  { email: 'maria@abv.bg', password: '123456789', label: 'Maria' },
  { email: 'peter@abv.bg', password: '123456789', label: 'Peter' },
];

const stageTemplates = [
  { name: 'not started', position: 0 },
  { name: 'in progress', position: 1 },
  { name: 'done', position: 2 },
];

function getTasksForProject(projectId, stageIdMap, createdByUserId) {
  const tasks = [];
  const stagePlan = [
    { stage: 'not started', count: 4 },
    { stage: 'in progress', count: 3 },
    { stage: 'done', count: 3 },
  ];

  let sequence = 1;
  for (const item of stagePlan) {
    for (let i = 1; i <= item.count; i += 1) {
      const isDone = item.stage === 'done';
      tasks.push({
        project_id: projectId,
        stage_id: stageIdMap[item.stage],
        title: `Task ${sequence}`,
        description_html: `<p>Sample description for task ${sequence} in <strong>${item.stage}</strong>.</p>`,
        position: i - 1,
        done: isDone,
        total_tracked_seconds: isDone ? 1800 : 0,
        timer_running: false,
        timer_started_at: null,
        created_by_user_id: createdByUserId,
      });
      sequence += 1;
    }
  }

  return tasks;
}

async function getAllUsersByEmailMap() {
  const emailToUser = new Map();
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`Failed to list users: ${error.message}`);
    }

    const users = data?.users ?? [];
    for (const user of users) {
      if (user.email) {
        emailToUser.set(user.email.toLowerCase(), user);
      }
    }

    if (users.length < perPage) {
      break;
    }

    page += 1;
  }

  return emailToUser;
}

async function ensureAuthUser(email, password, existingUsersMap) {
  const key = email.toLowerCase();
  const existing = existingUsersMap.get(key);

  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      email,
      password,
      email_confirm: true,
    });

    if (error) {
      throw new Error(`Failed to update user ${email}: ${error.message}`);
    }

    if (!data?.user?.id) {
      throw new Error(`Supabase returned no updated user id for ${email}`);
    }

    existingUsersMap.set(key, data.user);
    return data.user.id;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    throw new Error(`Failed to create user ${email}: ${error.message}`);
  }

  if (!data?.user?.id) {
    throw new Error(`Supabase returned no user id for ${email}`);
  }

  existingUsersMap.set(key, data.user);
  return data.user.id;
}

async function recreateProjectWithData(ownerUserId, projectTitle) {
  const { error: deleteError } = await supabase
    .from('projects')
    .delete()
    .eq('owner_user_id', ownerUserId)
    .eq('title', projectTitle);

  if (deleteError) {
    throw new Error(`Failed deleting existing project ${projectTitle}: ${deleteError.message}`);
  }

  const { data: createdProject, error: projectError } = await supabase
    .from('projects')
    .insert({
      owner_user_id: ownerUserId,
      title: projectTitle,
      description: `Seeded sample project for ${projectTitle}`,
    })
    .select('id')
    .single();

  if (projectError) {
    throw new Error(`Failed creating project ${projectTitle}: ${projectError.message}`);
  }

  const projectId = createdProject.id;

  const { data: createdStages, error: stageError } = await supabase
    .from('project_stages')
    .insert(
      stageTemplates.map((stage) => ({
        project_id: projectId,
        name: stage.name,
        position: stage.position,
      }))
    )
    .select('id,name');

  if (stageError) {
    throw new Error(`Failed creating stages for ${projectTitle}: ${stageError.message}`);
  }

  const stageIdMap = {};
  for (const stage of createdStages ?? []) {
    stageIdMap[stage.name] = stage.id;
  }

  const tasks = getTasksForProject(projectId, stageIdMap, ownerUserId);
  const { error: taskError } = await supabase.from('tasks').insert(tasks);

  if (taskError) {
    throw new Error(`Failed creating tasks for ${projectTitle}: ${taskError.message}`);
  }

  return projectId;
}

async function seed() {
  console.log('Starting seed...');

  const existingUsersMap = await getAllUsersByEmailMap();

  for (const userSpec of usersToSeed) {
    const userId = await ensureAuthUser(userSpec.email, userSpec.password, existingUsersMap);

    for (let i = 1; i <= 2; i += 1) {
      const projectTitle = `${userSpec.label} Project ${i}`;
      const projectId = await recreateProjectWithData(userId, projectTitle);
      console.log(`Seeded project ${projectTitle} (${projectId}) for ${userSpec.email}`);
    }
  }

  console.log('Seed completed successfully.');
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
