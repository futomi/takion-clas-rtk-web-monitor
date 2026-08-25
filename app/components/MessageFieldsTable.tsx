import type { MessageFieldExplanation } from '../lib/messageDictionary';

/** 電文の主要フィールド解説テーブル */
export default function MessageFieldsTable({ fields }: { fields: MessageFieldExplanation[] }) {
  return (
    <table className="fields-table">
      <thead>
        <tr>
          <th className="fields-table-name-col">項目名</th>
          <th>解説・単位</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => (
          <tr key={field.name}>
            <td className="field-name">{field.name}</td>
            <td className="field-desc">{field.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
