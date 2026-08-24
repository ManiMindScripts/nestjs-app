import { BadRequestException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import type { EntityTarget, ObjectLiteral } from 'typeorm';

interface ReplaceJoinRowsOptions {
  manager: EntityManager;
  joinEntity: EntityTarget<ObjectLiteral>;
  filter: Record<string, unknown>;
  foreignKeyField: string;
  referencedEntity: EntityTarget<ObjectLiteral>;
  ids: string[];
  label: string;
}

/**
 * Atomically replaces the join rows for one owner (e.g. a user's roles or a
 * role's permissions): validates that every id exists BEFORE wiping the
 * current set, then deletes and re-inserts inside the caller's transaction.
 */
export async function replaceJoinRows({
  manager,
  joinEntity,
  filter,
  foreignKeyField,
  referencedEntity,
  ids,
  label,
}: ReplaceJoinRowsOptions): Promise<void> {
  const distinctIds = [...new Set(ids)];

  if (distinctIds.length > 0) {
    const existing = (await manager.find(referencedEntity, {
      where: { id: In(distinctIds) },
      select: { id: true },
    })) as { id: string }[];
    if (existing.length !== distinctIds.length) {
      const found = new Set(existing.map((row) => row.id));
      const missing = distinctIds.filter((id) => !found.has(id));
      throw new BadRequestException(
        `Unknown ${label} id(s): ${missing.join(', ')}`,
      );
    }
  }

  await manager.delete(joinEntity, filter);
  if (distinctIds.length > 0) {
    await manager.save(
      joinEntity,
      distinctIds.map((id) =>
        manager.create(joinEntity, { ...filter, [foreignKeyField]: id }),
      ),
    );
  }
}
