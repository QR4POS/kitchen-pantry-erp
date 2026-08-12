// Minimal fluent Supabase query-builder mock used by the agent tests.
// Handlers are registered per table; each handler receives a descriptor
// describing the pending query and returns { data, error } (or undefined →
// { data: null, error: null }). Every query is also recorded on `queries`
// so tests can assert the exact operations the agent performed.

export interface QueryDescriptor {
  table: string
  mode: 'select' | 'insert' | 'update' | 'delete'
  selectCols: string | null
  filters: Record<string, unknown>
  inFilters: Record<string, unknown[]>
  likeFilters: Record<string, string>
  orderBy: [string, { ascending?: boolean }] | null
  limit: number | null
  payload: unknown
  single: boolean
  maybeSingle: boolean
}

type QueryResult = { data: unknown; error: unknown }

type Handler = (q: QueryDescriptor) => QueryResult | undefined

class MockBuilder {
  private desc: QueryDescriptor

  constructor(
    private table: string,
    private handlers: (q: QueryDescriptor) => QueryResult | undefined,
    private queries: QueryDescriptor[],
  ) {
    this.desc = {
      table,
      mode: 'select',
      selectCols: null,
      filters: {},
      inFilters: {},
      likeFilters: {},
      orderBy: null,
      limit: null,
      payload: null,
      single: false,
      maybeSingle: false,
    }
  }

  select(cols: string | Record<string, unknown> = '*') {
    this.desc.selectCols = typeof cols === 'string' ? cols : '*'
    return this
  }

  insert(payload: unknown) {
    this.desc.mode = 'insert'
    this.desc.payload = payload
    return this
  }

  update(payload: unknown) {
    this.desc.mode = 'update'
    this.desc.payload = payload
    return this
  }

  delete() {
    this.desc.mode = 'delete'
    return this
  }

  eq(col: string, value: unknown) {
    this.desc.filters[col] = value
    return this
  }

  in(col: string, values: unknown[]) {
    this.desc.inFilters[col] = values
    return this
  }

  ilike(col: string, value: string) {
    this.desc.likeFilters[col] = value
    return this
  }

  order(col: string, opts: { ascending?: boolean } = {}) {
    this.desc.orderBy = [col, opts]
    return this
  }

  limit(n: number) {
    this.desc.limit = n
    return this
  }

  maybeSingle() {
    this.desc.maybeSingle = true
    return this
  }

  single() {
    this.desc.single = true
    return this
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onFulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | undefined,
  ): Promise<TResult1 | TResult2> {
    this.queries.push({ ...this.desc })
    const result = this.handlers(this.desc) ?? { data: null, error: null }
    return Promise.resolve(result).then(onFulfilled as (value: QueryResult) => TResult1 | PromiseLike<TResult1>)
  }
}

export interface MockDb {
  db: {
    from: (table: string) => MockBuilder
    rpc: (name: string, args?: Record<string, unknown>) => Promise<QueryResult>
  }
  queries: QueryDescriptor[]
  on: (table: string, handler: Handler) => void
  onAny: (handler: Handler) => void
}

export function createMockDb(): MockDb {
  const queries: QueryDescriptor[] = []
  const handlers = new Map<string, Handler>()
  let anyHandler: Handler | null = null

  const resolve = (table: string, desc: QueryDescriptor): QueryResult | undefined => {
    const h = handlers.get(table)
    if (h) return h(desc)
    if (anyHandler) return anyHandler(desc)
    return { data: null, error: null }
  }

  const db = {
    from: (table: string) => new MockBuilder(table, (desc) => resolve(table, desc), queries),
    rpc: () => Promise.resolve({ data: [], error: null } as QueryResult),
  }

  return {
    db,
    queries,
    on: (table, handler) => handlers.set(table, handler),
    onAny: (handler) => {
      anyHandler = handler
    },
  }
}
