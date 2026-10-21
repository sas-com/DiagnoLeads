/**
 * FAQ Repository
 *
 * FAQのデータアクセスを抽象化
 * CMS実装に依存しないインターフェースを提供
 * キャッシュ機能付き
 */

import { unstable_cache } from 'next/cache';
import { getCMSAdapter } from '../adapters/factory';
import {
  CMS_CACHE_CONFIG,
  getCollectionTag,
  getDocumentTag,
  invalidateCollection,
  invalidateDocument,
} from '../core/cache';
import type { CMSAdapter, WhereCondition, WhereOperator } from '../core/interfaces';
import type { FAQ } from '../core/types';

export interface FindFAQsOptions {
  /** Published FAQs only unless 'all' is asked for (editors) */
  status?: 'published' | 'all';
  category?: string;
  limit?: number;
  offset?: number;
}

export interface FAQsResult {
  faqs: FAQ[];
  total: number;
}

export interface FAQsByCategory {
  category: string;
  faqs: FAQ[];
}

const COLLECTION = 'faqs';
const REVALIDATE = CMS_CACHE_CONFIG.collections[COLLECTION] || CMS_CACHE_CONFIG.defaultRevalidate;

export class FAQRepository {
  private adapter: CMSAdapter;

  constructor(adapter?: CMSAdapter) {
    this.adapter = adapter || getCMSAdapter();
  }

  /**
   * FAQ一覧を取得（キャッシュなし - 管理画面用）
   */
  async findAll(options: FindFAQsOptions = {}): Promise<FAQsResult> {
    const { category, limit = 100, offset = 0, status = 'published' } = options;

    const where: WhereCondition = {};

    if (category) {
      where.category = { equals: category } as WhereOperator;
    }

    const { data, meta } = await this.adapter.find<FAQ>({
      collection: COLLECTION,
      where: Object.keys(where).length > 0 ? where : undefined,
      limit,
      offset,
      sort: [{ field: 'order', order: 'asc' }],
      status,
    });

    return {
      faqs: data,
      total: meta?.total || 0,
    };
  }

  /**
   * FAQ一覧を取得（キャッシュ付き - 公開ページ用）
   */
  async findAllCached(options: FindFAQsOptions = {}): Promise<FAQsResult> {
    const cacheKey = `findAll:${JSON.stringify(options)}`;

    const cached = unstable_cache(
      async () => this.findAll(options),
      [`cms:${COLLECTION}:${cacheKey}`],
      {
        revalidate: REVALIDATE,
        tags: [getCollectionTag(COLLECTION)],
      }
    );

    return cached();
  }

  /**
   * IDでFAQを取得（キャッシュなし）
   */
  async findById(id: string): Promise<FAQ | null> {
    const { data } = await this.adapter.findById<FAQ>({
      collection: COLLECTION,
      id,
    });

    return data;
  }

  /**
   * IDでFAQを取得（キャッシュ付き）
   */
  async findByIdCached(id: string): Promise<FAQ | null> {
    const cached = unstable_cache(async () => this.findById(id), [`cms:${COLLECTION}:id:${id}`], {
      revalidate: REVALIDATE,
      tags: [getCollectionTag(COLLECTION), getDocumentTag(COLLECTION, id)],
    });

    return cached();
  }

  /**
   * FAQを検索
   */
  async search(query: string): Promise<FAQ[]> {
    const { data } = await this.adapter.search<FAQ>({
      collection: COLLECTION,
      query,
      fields: ['question.ja', 'question.en', 'answer.ja', 'answer.en'],
    });

    return data;
  }

  /**
   * カテゴリ別にグループ化されたFAQを取得（キャッシュなし）
   */
  async findByCategories(): Promise<FAQsByCategory[]> {
    const { faqs } = await this.findAll();

    // カテゴリ別にグループ化
    const grouped = new Map<string, FAQ[]>();

    for (const faq of faqs) {
      const category = faq.category || 'general';
      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      grouped.get(category)?.push(faq);
    }

    // カテゴリ順にソート
    const categoryOrder = ['features', 'pricing', 'technical', 'general'];
    const result: FAQsByCategory[] = [];

    for (const category of categoryOrder) {
      const faqs = grouped.get(category);
      if (faqs) {
        result.push({ category, faqs });
      }
    }

    // 残りのカテゴリを追加
    for (const [category, items] of grouped) {
      if (!categoryOrder.includes(category)) {
        result.push({ category, faqs: items });
      }
    }

    return result;
  }

  /**
   * カテゴリ別にグループ化されたFAQを取得（キャッシュ付き - 公開ページ用）
   */
  async findByCategoriesCached(): Promise<FAQsByCategory[]> {
    const cached = unstable_cache(
      async () => this.findByCategories(),
      [`cms:${COLLECTION}:byCategories`],
      {
        revalidate: REVALIDATE,
        tags: [getCollectionTag(COLLECTION)],
      }
    );

    return cached();
  }

  /**
   * FAQを作成
   */
  async create(faq: Omit<FAQ, 'id' | 'publishedAt'>): Promise<FAQ> {
    const { data } = await this.adapter.create<FAQ>({
      collection: COLLECTION,
      data: {
        ...faq,
        publishedAt: new Date(),
      },
    });

    // キャッシュを無効化
    await invalidateCollection(COLLECTION);

    return data;
  }

  /**
   * FAQを更新
   */
  async update(id: string, updates: Partial<Omit<FAQ, 'id'>>): Promise<FAQ> {
    const { data } = await this.adapter.update<FAQ>({
      collection: COLLECTION,
      id,
      data: updates,
    });

    // キャッシュを無効化
    await invalidateDocument(COLLECTION, id);

    return data;
  }

  /**
   * FAQを削除
   */
  async delete(id: string): Promise<void> {
    await this.adapter.delete({
      collection: COLLECTION,
      id,
    });

    // キャッシュを無効化
    await invalidateDocument(COLLECTION, id);
    await invalidateCollection(COLLECTION);
  }

  /**
   * カテゴリ一覧を取得（キャッシュなし）
   */
  async getCategories(): Promise<string[]> {
    const { faqs } = await this.findAll();

    const categories = new Set<string>();
    for (const faq of faqs) {
      if (faq.category) {
        categories.add(faq.category);
      }
    }

    return Array.from(categories);
  }

  /**
   * カテゴリ一覧を取得（キャッシュ付き - 公開ページ用）
   */
  async getCategoriesCached(): Promise<string[]> {
    const cached = unstable_cache(
      async () => this.getCategories(),
      [`cms:${COLLECTION}:categories`],
      {
        revalidate: REVALIDATE,
        tags: [getCollectionTag(COLLECTION)],
      }
    );

    return cached();
  }

  /**
   * 順序を更新（一括）
   */
  async updateOrder(updates: Array<{ id: string; order: number }>): Promise<void> {
    await this.adapter.bulkUpdate({
      collection: COLLECTION,
      updates: updates.map(({ id, order }) => ({
        id,
        data: { order },
      })),
    });

    // キャッシュを無効化
    await invalidateCollection(COLLECTION);
  }
}
