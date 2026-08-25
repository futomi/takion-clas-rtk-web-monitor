'use client';

import { useMemo, useState } from 'react';
import { buildCategoryOptions, getAllMessageDefinitions, type MessageCategory } from '../lib/messageDictionary';
import Modal from './Modal';

/** カテゴリ絞り込みタブ。並びと表記はログパネルの絞り込みと同じ定義元から引く */
const CATEGORY_TABS = buildCategoryOptions('すべて');

/** 受信しうる全電文の解説一覧モーダル */
export default function MessageDictionaryModal({ onClose }: { onClose: () => void }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryTab, setCategoryTab] = useState<'all' | MessageCategory>('all');

  const allDefinitions = useMemo(() => getAllMessageDefinitions(), []);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return allDefinitions.filter((item) => {
      if (categoryTab !== 'all' && item.category !== categoryTab) return false;
      if (!query) return true;
      return [item.type, item.displayName, item.titleJa, item.summary, item.description]
        .some((text) => text.toLowerCase().includes(query));
    });
  }, [allDefinitions, categoryTab, searchQuery]);

  return (
    <Modal
      onClose={onClose}
      title="受信電文リファレンス解説一覧"
      titleAccessory={<span className="modal-title-icon">📖</span>}
      maxWidth="780px"
    >
      <div className="dict-filter-bar">
        <input
          type="text"
          placeholder="電文名やキーワードで検索 (例: GGA, CLAS, Fix, RTCM...)"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          aria-label="電文の検索"
        />
      </div>

      <div className="dict-tab-row">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            className={`secondary-btn dict-tab ${categoryTab === tab.value ? 'active' : ''}`}
            onClick={() => setCategoryTab(tab.value)}
            aria-pressed={categoryTab === tab.value}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="dict-grid">
        {filtered.length === 0 ? (
          <div className="dict-empty">該当する電文が見つかりませんでした。</div>
        ) : (
          filtered.map((item) => (
            <div className="dict-card" key={item.type}>
              <div className="dict-card-header">
                <div className="dict-card-title-group">
                  <span className={`cat-badge ${item.category}`}>{item.categoryJa}</span>
                  <span className="dict-card-title">{item.displayName} · {item.titleJa}</span>
                </div>
              </div>
              <div className="dict-card-summary">{item.summary}</div>
              <div className="dict-card-desc">{item.description}</div>
              {item.fields && item.fields.length > 0 && (
                <div className="dict-card-fields">
                  <b>含まれる主な項目:</b> {item.fields.map((field) => field.name).join('、')}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
