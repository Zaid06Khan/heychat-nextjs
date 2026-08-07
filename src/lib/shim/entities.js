'use client';

import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Base44-shaped entity client backed by Supabase.
 *
 * The goal is narrow and specific: reproduce the exact call surface the existing
 * components already use, so none of them have to change —
 *
 *     entities.X.filter(where, sort, limit)
 *     entities.X.get(id)
 *     entities.X.create(data)
 *     entities.X.update(id, data)
 *     entities.X.delete(id)
 *     entities.X.deleteMany(where)
 *     entities.X.subscribe(cb)  ->  unsubscribe fn
 *
 * This is a migration aid, not a permanent abstraction. As screens move to real
 * App Router pages they should call Supabase (or server actions) directly, and
 * this file should shrink. See FOLLOWUPS.md.
 */

/** Base44 entity name -> Postgres table. */
const TABLES = {
  Account: 'accounts',
  Conversation: 'conversations',
  Message: 'messages',
  ContactRequest: 'contact_requests',
  Call: 'calls',
  Earning: 'earnings',
  Report: 'reports',
};

/**
 * Postgres array columns. Base44 treated `filter({ participant_ids: myId })` on
 * an array field as "contains", so a bare scalar has to become a containment
 * test rather than equality.
 */
const ARRAY_COLUMNS = {
  conversations: new Set(['participant_ids']),
  calls: new Set(['participant_ids']),
  messages: new Set(['read_by']),
  accounts: new Set(['blocked_account_ids']),
};

/**
 * postgres `numeric` arrives as a *string* over the wire to preserve precision.
 * Base44 handed these back as JS numbers, and Earn.jsx does `sum + amount`,
 * which would silently string-concatenate. Coerce on read so the components see
 * what they saw before.
 */
const NUMERIC_COLUMNS = {
  earnings: ['reward_amount'],
};

function coerceRow(table, row) {
  const cols = NUMERIC_COLUMNS[table];
  if (!row || !cols) return row;
  const out = { ...row };
  for (const col of cols) {
    if (out[col] !== null && out[col] !== undefined) out[col] = Number(out[col]);
  }
  return out;
}

function coerceRows(table, rows) {
  if (!NUMERIC_COLUMNS[table]) return rows || [];
  return (rows || []).map((r) => coerceRow(table, r));
}

/** Translates one Base44 filter entry onto a PostgREST query. */
function applyCondition(query, table, key, value) {
  const isArrayColumn = ARRAY_COLUMNS[table]?.has(key);

  // Mongo-ish operator object, e.g. { expiry_at: { $lt: iso } }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [op, operand] of Object.entries(value)) {
      switch (op) {
        case '$lt':  query = query.lt(key, operand); break;
        case '$lte': query = query.lte(key, operand); break;
        case '$gt':  query = query.gt(key, operand); break;
        case '$gte': query = query.gte(key, operand); break;
        case '$ne':  query = query.neq(key, operand); break;
        case '$in':  query = query.in(key, operand); break;
        default:
          throw new Error(`Unsupported filter operator "${op}" on ${table}.${key}`);
      }
    }
    return query;
  }

  if (isArrayColumn) {
    return query.contains(key, Array.isArray(value) ? value : [value]);
  }

  if (Array.isArray(value)) {
    return query.in(key, value);
  }

  return query.eq(key, value);
}

function applyWhere(query, table, where) {
  for (const [key, value] of Object.entries(where || {})) {
    query = applyCondition(query, table, key, value);
  }
  return query;
}

/** Base44 sort strings: 'created_date' asc, '-created_date' desc. */
function applySort(query, sort) {
  if (!sort) return query;
  const descending = sort.startsWith('-');
  const column = descending ? sort.slice(1) : sort;
  return query.order(column, { ascending: !descending });
}

function unwrap(table, { data, error }, { single = false } = {}) {
  if (error) {
    // Surface the Postgres message — an RLS rejection reads as
    // "new row violates row-level security policy", which is the truth and is
    // far more useful than a generic failure.
    throw new Error(error.message || 'Request failed');
  }
  return single ? coerceRow(table, data) : coerceRows(table, data);
}

function createEntity(entityName) {
  const table = TABLES[entityName];
  if (!table) throw new Error(`Unknown entity "${entityName}"`);

  return {
    async filter(where = {}, sort = null, limit = null) {
      const supabase = getSupabaseBrowserClient();
      let query = supabase.from(table).select('*');
      query = applyWhere(query, table, where);
      query = applySort(query, sort);
      if (limit) query = query.limit(limit);
      return unwrap(table, await query);
    },

    async list(sort = null, limit = null) {
      return this.filter({}, sort, limit);
    },

    async get(id) {
      const supabase = getSupabaseBrowserClient();
      const result = await supabase.from(table).select('*').eq('id', id).single();
      return unwrap(table, result, { single: true });
    },

    async create(data) {
      const supabase = getSupabaseBrowserClient();
      const result = await supabase.from(table).insert(data).select().single();
      return unwrap(table, result, { single: true });
    },

    async update(id, data) {
      const supabase = getSupabaseBrowserClient();

      // Read receipts are the one case where a non-author writes to someone
      // else's row. RLS only lets the author UPDATE a message, so this is
      // routed to an append-only function instead of widening the policy.
      if (table === 'messages') {
        const keys = Object.keys(data || {});
        if (keys.length === 1 && keys[0] === 'read_by') {
          const { error } = await supabase.rpc('mark_message_read', {
            message_id: id,
          });
          if (error) throw new Error(error.message);
          return this.get(id);
        }
      }

      const result = await supabase
        .from(table)
        .update(data)
        .eq('id', id)
        .select()
        .single();
      return unwrap(table, result, { single: true });
    },

    async delete(id) {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw new Error(error.message);
      return { id };
    },

    async deleteMany(where = {}) {
      if (!where || Object.keys(where).length === 0) {
        // Guard against an accidental "delete the whole table".
        throw new Error('deleteMany requires at least one condition');
      }
      const supabase = getSupabaseBrowserClient();
      let query = supabase.from(table).delete();
      query = applyWhere(query, table, where);
      const { error } = await query;
      if (error) throw new Error(error.message);
      return { ok: true };
    },

    /**
     * Realtime. Callback receives { type, data } where `data` is the new row
     * (or the old row on delete), matching how the components already read
     * `event.data?.conversation_id`.
     *
     * Realtime enforces RLS, so a client is only pushed rows it could have
     * SELECTed itself.
     */
    subscribe(callback) {
      const supabase = getSupabaseBrowserClient();
      const channel = supabase
        .channel(`shim:${table}:${Math.random().toString(36).slice(2)}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          (payload) => {
            const row =
              payload.eventType === 'DELETE' ? payload.old : payload.new;
            callback({
              type: payload.eventType,
              data: coerceRow(table, row),
            });
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    },
  };
}

export const entities = Object.fromEntries(
  Object.keys(TABLES).map((name) => [name, createEntity(name)])
);
