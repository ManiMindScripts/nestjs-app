import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { replaceJoinRows } from './replace-join-rows';

type Options = Parameters<typeof replaceJoinRows>[0];

describe('replaceJoinRows', () => {
  let manager: EntityManager;
  let findMock: jest.Mock;
  let deleteMock: jest.Mock;
  let saveMock: jest.Mock;
  let createMock: jest.Mock;
  const joinEntity = Symbol('JoinEntity') as unknown as Options['joinEntity'];
  const referencedEntity = Symbol(
    'ReferencedEntity',
  ) as unknown as Options['referencedEntity'];
  const filter: Options['filter'] = { userId: 'user-1' };

  let options: Options;

  beforeEach(() => {
    findMock = jest.fn();
    deleteMock = jest.fn().mockResolvedValue(undefined);
    saveMock = jest.fn().mockResolvedValue(undefined);
    createMock = jest.fn((_entity: unknown, data: unknown) => data);
    manager = {
      find: findMock,
      delete: deleteMock,
      save: saveMock,
      create: createMock,
    } as unknown as EntityManager;

    options = {
      manager,
      joinEntity,
      filter,
      foreignKeyField: 'roleId',
      referencedEntity,
      ids: [],
      label: 'role',
    };
  });

  it('validates every referenced id before wiping the current set', async () => {
    options.ids = ['r1', 'r2'];
    findMock.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);

    await replaceJoinRows(options);

    expect(findMock).toHaveBeenCalled();
    expect(deleteMock).toHaveBeenCalledWith(joinEntity, filter);
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(saveMock).toHaveBeenCalledWith(
      joinEntity,
      expect.arrayContaining([
        { userId: 'user-1', roleId: 'r1' },
        { userId: 'user-1', roleId: 'r2' },
      ]),
    );
  });

  it('throws 400 listing the missing ids', async () => {
    options.ids = ['r1', 'r2'];
    findMock.mockResolvedValue([{ id: 'r1' }]);

    await expect(replaceJoinRows(options)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('deletes all join rows without validating when the id list is empty', async () => {
    options.ids = [];
    findMock.mockResolvedValue([{ id: 'something' }]);

    await replaceJoinRows(options);

    expect(findMock).toHaveBeenCalledTimes(0);
    expect(deleteMock).toHaveBeenCalledWith(joinEntity, filter);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('deduplicates repeated ids', async () => {
    options.ids = ['r1', 'r1'];
    findMock.mockResolvedValue([{ id: 'r1' }]);

    await replaceJoinRows(options);

    expect(saveMock).toHaveBeenCalledWith(
      joinEntity,
      expect.arrayContaining([{ userId: 'user-1', roleId: 'r1' }]),
    );
    const rows = (
      saveMock as jest.Mock<
        Promise<unknown>,
        [target: unknown, rows: unknown[]]
      >
    ).mock.calls[0][1];
    expect(rows).toHaveLength(1);
  });
});
