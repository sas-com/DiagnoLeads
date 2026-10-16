/**
 * CMS adapter while the CMS is off (lib/cms/enabled.ts): public pages show no content instead
 * of failing, and nothing can be saved.
 */
import { CMSConnectionError } from '../../core/errors';
import type {
  CMSAdapter,
  CMSResponse,
  ExportData,
  ExportParams,
  ImportResult,
} from '../../core/interfaces';

const EMPTY_META = {
  total: 0,
  page: 1,
  pageSize: 0,
  hasNextPage: false,
  hasPrevPage: false,
};

function disabled(): never {
  throw new CMSConnectionError('The CMS is not enabled in this environment');
}

export class DisabledCMSAdapter implements CMSAdapter {
  readonly name = 'Disabled';
  readonly version = '0';

  async initialize(): Promise<void> {}
  async healthCheck(): Promise<boolean> {
    return false;
  }

  async find<T>(): Promise<CMSResponse<T[]>> {
    return { data: [], meta: EMPTY_META };
  }
  async findById<T>(): Promise<CMSResponse<T | null>> {
    return { data: null };
  }
  async findBySlug<T>(): Promise<CMSResponse<T | null>> {
    return { data: null };
  }
  async search<T>(): Promise<CMSResponse<T[]>> {
    return { data: [] };
  }

  async create<T>(): Promise<CMSResponse<T>> {
    return disabled();
  }
  async update<T>(): Promise<CMSResponse<T>> {
    return disabled();
  }
  async delete(): Promise<CMSResponse<void>> {
    return disabled();
  }
  async bulkCreate<T>(): Promise<CMSResponse<T[]>> {
    return disabled();
  }
  async bulkUpdate<T>(): Promise<CMSResponse<T[]>> {
    return disabled();
  }
  async bulkDelete(): Promise<CMSResponse<void>> {
    return disabled();
  }
  async revalidate(): Promise<void> {}
  async export(_params: ExportParams): Promise<ExportData> {
    return disabled();
  }
  async import(): Promise<ImportResult> {
    return disabled();
  }
}
