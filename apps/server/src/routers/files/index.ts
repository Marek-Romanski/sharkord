import { t } from '../../utils/trpc';
import { deleteFileRoute } from './delete-file';
import { deleteTemporaryFileRoute } from './delete-temporary-file';
import { refreshFileTokensRoute } from './refresh-file-tokens';

export const filesRouter = t.router({
  delete: deleteFileRoute,
  deleteTemporary: deleteTemporaryFileRoute,
  refreshTokens: refreshFileTokensRoute
});
