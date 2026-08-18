import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { PermissionAction } from '../../../common/constants/permissions.enum';
import { RolePermission } from './role-permission.entity';

const PERMISSION_ACTION_CHECK = Object.values(PermissionAction)
  .map((value) => `'${value}'`)
  .join(', ');

@Entity('permissions')
@Unique('UQ_permissions_action_subject', ['action', 'subject'])
@Check(
  'CHK_permissions_action_valid',
  `"action" IN (${PERMISSION_ACTION_CHECK})`,
)
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  action: PermissionAction;

  @Column({ type: 'varchar', length: 100 })
  subject: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @OneToMany(
    () => RolePermission,
    (rolePermission) => rolePermission.permission,
  )
  rolePermissions: RolePermission[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
