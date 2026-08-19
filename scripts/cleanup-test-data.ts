import 'dotenv/config';
import { In, Like } from 'typeorm';
import dataSource from '../src/database/data-source';
import { User } from '../src/modules/users/entities/user.entity';

const TEST_EMAIL_PATTERNS = [
  'rbac\\_%@example.com',
  'e2e\\_%@example.com',
  'smoke\\_%@example.com',
] as const;

function hasArg(name: string): boolean {
  return process.argv.slice(2).includes(name);
}

function printUsage(): void {
  console.log(
    [
      'Usage: npm run cleanup:test-data [-- --apply] [-- --force]',
      '',
      'Deletes users created by automated tests (rbac_*, e2e_*, smoke_*) and their',
      'cascaded rows (user_roles, refresh_tokens, password_reset_tokens).',
      '',
      '  --apply   actually delete the matched users (default is a dry run)',
      '  --force   allow execution when NODE_ENV=production',
      '',
    ].join('\n'),
  );
}

async function run(): Promise<void> {
  const apply = hasArg('--apply');
  const force = hasArg('--force');
  const isProduction =
    (process.env.NODE_ENV ?? 'development').toLowerCase() === 'production';

  if (isProduction && !force) {
    console.error(
      'Refusing to run against a production database. Pass --force to override.',
    );
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    printUsage();
  }

  await dataSource.initialize();

  try {
    const removed = await dataSource.transaction(async (manager) => {
      const targets = await manager.getRepository(User).find({
        withDeleted: true,
        where: TEST_EMAIL_PATTERNS.map((pattern) => ({
          email: Like(pattern),
        })),
      });

      if (targets.length === 0) {
        console.log('No test users found.');
        return 0;
      }

      console.log(`Found ${targets.length} test user(s):`);
      for (const target of targets) {
        console.log(`  - ${target.email}`);
      }

      if (!apply) {
        return 0;
      }

      await manager
        .getRepository(User)
        .delete({ id: In(targets.map((target) => target.id)) });
      return targets.length;
    });

    if (apply && removed > 0) {
      console.log(
        `Deleted ${removed} test user(s); child rows (user_roles, refresh_tokens, password_reset_tokens) were removed by ON DELETE CASCADE.`,
      );
    }
  } finally {
    await dataSource.destroy();
  }
}

void run().catch((error: unknown) => {
  console.error('Cleanup failed:', error);
  process.exit(1);
});
