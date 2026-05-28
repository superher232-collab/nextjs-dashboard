import postgres from 'postgres';
import * as path from 'path';
import * as fs from 'fs';
import bcrypt from 'bcryptjs';
import { users, customers, invoices, revenue } from './placeholder-data';

const globalForSql = global as unknown as { sql: any };

// PostgreSQL client instance for online operation
let pgSql: any = null;
if (process.env.POSTGRES_URL) {
  try {
    pgSql = postgres(process.env.POSTGRES_URL, {
      ssl: 'require',
      connect_timeout: 3, // fast timeout for connection detection
    });
  } catch (e) {
    console.warn('[Offline DB] Failed to initialize Postgres driver:', e);
  }
} else {
  console.warn('[Offline DB] POSTGRES_URL not found. Defaulting to offline JSON database mode.');
}

let offlineMode = !process.env.POSTGRES_URL;

// --- Pure JS JSON Database Fallback Implementation ---

const dbPath = path.join(process.cwd(), 'db.json');

interface Invoice {
  id: string;
  customer_id: string;
  amount: number;
  status: string;
  date: string;
}

interface DbState {
  users: typeof users;
  customers: typeof customers;
  invoices: Invoice[];
  revenue: typeof revenue;
}

function getDbState(): DbState {
  if (!fs.existsSync(dbPath)) {
    console.log('[Offline DB] Initializing local db.json database from placeholder data...');
    // Seed new UUIDs for baseline invoices
    const invoicesWithIds = invoices.map(inv => ({
      id: crypto.randomUUID(),
      ...inv
    }));
    const state: DbState = {
      users: users.map(u => ({ ...u, password: bcrypt.hashSync(u.password, 10) })),
      customers,
      invoices: invoicesWithIds,
      revenue
    };
    fs.writeFileSync(dbPath, JSON.stringify(state, null, 2), 'utf-8');
    return state;
  }
  return JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
}

function saveDbState(state: DbState) {
  fs.writeFileSync(dbPath, JSON.stringify(state, null, 2), 'utf-8');
}

function executeQuery(sqlQuery: string, params: any[]): any {
  const state = getDbState();
  const query = sqlQuery.trim().replace(/\s+/g, ' ');
  const upper = query.toUpperCase();

  // 1. SELECT * FROM revenue
  if (upper === 'SELECT * FROM REVENUE') {
    return state.revenue;
  }

  // 2. Fetch latest invoices
  if (upper.includes('FROM INVOICES') && upper.includes('JOIN CUSTOMERS') && upper.includes('ORDER BY INVOICES.DATE DESC LIMIT 5')) {
    const joined = state.invoices.map(inv => {
      const cust = state.customers.find(c => c.id === inv.customer_id);
      return {
        id: inv.id,
        amount: inv.amount,
        date: inv.date,
        status: inv.status,
        name: cust ? cust.name : '',
        email: cust ? cust.email : '',
        image_url: cust ? cust.image_url : ''
      };
    });
    joined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return joined.slice(0, 5);
  }

  // 3. SELECT COUNT(*) FROM invoices / customers
  if (upper === 'SELECT COUNT(*) FROM INVOICES') {
    return [{ count: state.invoices.length }];
  }
  if (upper === 'SELECT COUNT(*) FROM CUSTOMERS') {
    return [{ count: state.customers.length }];
  }

  // 4. Card invoice status summation
  if (upper.includes('SUM(CASE WHEN STATUS = \'PAID\'')) {
    const paid = state.invoices
      .filter(inv => inv.status === 'paid')
      .reduce((sum, inv) => sum + inv.amount, 0);
    const pending = state.invoices
      .filter(inv => inv.status === 'pending')
      .reduce((sum, inv) => sum + inv.amount, 0);
    return [{ paid, pending }];
  }

  // 5. Fetch filtered invoices with pagination
  if (upper.includes('SELECT INVOICES.ID, INVOICES.AMOUNT, INVOICES.DATE') && upper.includes('JOIN CUSTOMERS')) {
    const filterTerm = (params[0] as string || '').replace(/%/g, '').toLowerCase();
    const limit = params[params.length - 2] as number;
    const offset = params[params.length - 1] as number;

    const joined = state.invoices.map(inv => {
      const cust = state.customers.find(c => c.id === inv.customer_id);
      return {
        id: inv.id,
        amount: inv.amount,
        date: inv.date,
        status: inv.status,
        name: cust ? cust.name : '',
        email: cust ? cust.email : '',
        image_url: cust ? cust.image_url : ''
      };
    });

    const filtered = joined.filter(inv => {
      return (
        inv.name.toLowerCase().includes(filterTerm) ||
        inv.email.toLowerCase().includes(filterTerm) ||
        String(inv.amount).toLowerCase().includes(filterTerm) ||
        inv.date.toLowerCase().includes(filterTerm) ||
        inv.status.toLowerCase().includes(filterTerm)
      );
    });

    filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return filtered.slice(offset, offset + limit);
  }

  // 6. Fetch invoices pages count
  if (upper.includes('SELECT COUNT(*)') && upper.includes('FROM INVOICES JOIN CUSTOMERS')) {
    const filterTerm = (params[0] as string || '').replace(/%/g, '').toLowerCase();
    const joined = state.invoices.map(inv => {
      const cust = state.customers.find(c => c.id === inv.customer_id);
      return {
        id: inv.id,
        amount: inv.amount,
        date: inv.date,
        status: inv.status,
        name: cust ? cust.name : '',
        email: cust ? cust.email : '',
        image_url: cust ? cust.image_url : ''
      };
    });

    const filtered = joined.filter(inv => {
      return (
        inv.name.toLowerCase().includes(filterTerm) ||
        inv.email.toLowerCase().includes(filterTerm) ||
        String(inv.amount).toLowerCase().includes(filterTerm) ||
        inv.date.toLowerCase().includes(filterTerm) ||
        inv.status.toLowerCase().includes(filterTerm)
      );
    });

    return [{ count: filtered.length }];
  }

  // 7. Fetch invoice by ID
  if (upper.includes('SELECT INVOICES.ID, INVOICES.CUSTOMER_ID') && upper.includes('WHERE INVOICES.ID =')) {
    const id = params[0];
    const inv = state.invoices.find(i => i.id === id);
    return inv ? [inv] : [];
  }

  // 8. Fetch customers sorted ASC by name
  if (upper.includes('SELECT ID, NAME FROM CUSTOMERS ORDER BY NAME ASC')) {
    const sorted = [...state.customers];
    sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted.map(c => ({ id: c.id, name: c.name }));
  }

  // 9. Fetch filtered customers
  if (upper.includes('SELECT CUSTOMERS.ID, CUSTOMERS.NAME') && upper.includes('LEFT JOIN INVOICES')) {
    const filterTerm = (params[0] as string || '').replace(/%/g, '').toLowerCase();
    const result = state.customers
      .filter(cust => {
        return (
          cust.name.toLowerCase().includes(filterTerm) ||
          cust.email.toLowerCase().includes(filterTerm)
        );
      })
      .map(cust => {
        const custInvoices = state.invoices.filter(inv => inv.customer_id === cust.id);
        const total_invoices = custInvoices.length;
        const total_pending = custInvoices.filter(i => i.status === 'pending').reduce((sum, i) => sum + i.amount, 0);
        const total_paid = custInvoices.filter(i => i.status === 'paid').reduce((sum, i) => sum + i.amount, 0);
        return {
          id: cust.id,
          name: cust.name,
          email: cust.email,
          image_url: cust.image_url,
          total_invoices,
          total_pending,
          total_paid
        };
      });
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  // 10. INSERT INTO invoices
  if (upper.includes('INSERT INTO INVOICES')) {
    const [customerId, amount, status, date] = params;
    const newInvoice = {
      id: crypto.randomUUID(),
      customer_id: customerId,
      amount,
      status,
      date
    };
    state.invoices.push(newInvoice);
    saveDbState(state);
    return { changes: 1 };
  }

  // 11. UPDATE invoices
  if (upper.includes('UPDATE INVOICES')) {
    const [customerId, amount, status, id] = params;
    const idx = state.invoices.findIndex(inv => inv.id === id);
    if (idx !== -1) {
      state.invoices[idx] = {
        ...state.invoices[idx],
        customer_id: customerId,
        amount,
        status
      };
      saveDbState(state);
    }
    return { changes: 1 };
  }

  // 12. DELETE FROM invoices WHERE id = ?
  if (upper.includes('DELETE FROM INVOICES WHERE ID =')) {
    const id = params[0];
    state.invoices = state.invoices.filter(inv => inv.id !== id);
    saveDbState(state);
    return { changes: 1 };
  }

  // 13. INSERT INTO customers
  if (upper.includes('INSERT INTO CUSTOMERS')) {
    const [name, email, imageUrl] = params;
    const newCustomer = {
      id: crypto.randomUUID(),
      name,
      email,
      image_url: imageUrl
    };
    state.customers.push(newCustomer);
    saveDbState(state);
    return { changes: 1 };
  }

  // 14. DELETE FROM invoices WHERE customer_id = ?
  if (upper.includes('DELETE FROM INVOICES WHERE CUSTOMER_ID =')) {
    const id = params[0];
    state.invoices = state.invoices.filter(inv => inv.customer_id !== id);
    saveDbState(state);
    return { changes: 1 };
  }

  // 15. DELETE FROM customers WHERE id = ?
  if (upper.includes('DELETE FROM CUSTOMERS WHERE ID =')) {
    const id = params[0];
    state.customers = state.customers.filter(c => c.id !== id);
    saveDbState(state);
    return { changes: 1 };
  }

  // 17. Fetch user by email (offline support)
  if (upper.includes('SELECT * FROM USERS WHERE EMAIL =') || upper.includes('SELECT * FROM USERS WHERE EMAIL=?')) {
    const email = params[0];
    const user = state.users.find(u => u.email === email);
    return user ? [user] : [];
  }

  // 16. Skip schema definition statements (like extensions, seed inserts, etc.)
  if (upper.includes('CREATE TABLE') || upper.includes('CREATE EXTENSION') || upper.includes('INSERT INTO USERS')) {
    return [];
  }

  console.warn('[Offline DB] Unhandled SQL query in fallback driver:', query);
  return [];
}

async function runQuery(strings: TemplateStringsArray, ...values: any[]) {
  if (!offlineMode && pgSql) {
    try {
      return await pgSql(strings, ...values);
    } catch (error: any) {
      const errCode = String(error?.code || '');
      const errMsg = String(error?.message || '');
      const isNetworkError = 
        errCode === 'EAI_AGAIN' ||
        errCode === 'ENOTFOUND' ||
        errCode === 'ECONNREFUSED' ||
        errCode === 'CONNECT_TIMEOUT' ||
        errCode === 'ETIMEDOUT' ||
        errCode === 'EHOSTUNREACH' ||
        errCode === 'ENETUNREACH' ||
        errMsg.includes('getaddrinfo') ||
        errMsg.includes('connect') ||
        errMsg.includes('TIMEOUT') ||
        errMsg.includes('timeout') ||
        errMsg.includes('socket hang up');

      if (isNetworkError) {
        console.warn('[Offline DB] Postgres server unreachable. Switching to local JSON fallback database...');
        offlineMode = true;
      } else {
        throw error;
      }
    }
  }

  // Pure JavaScript JSON Fallback Execution
  const rawQuery = strings.join('?');
  return executeQuery(rawQuery, values);
}

const sqlWrapper = Object.assign(
  (strings: TemplateStringsArray, ...values: any[]) => runQuery(strings, ...values),
  {
    begin: async function (callback: (sql: any) => Promise<any>) {
      if (!offlineMode && pgSql) {
        try {
          return await pgSql.begin(callback);
        } catch (error: any) {
          const errCode = String(error?.code || '');
          const errMsg = String(error?.message || '');
          const isNetworkError = 
            errCode === 'EAI_AGAIN' ||
            errCode === 'ENOTFOUND' ||
            errCode === 'ECONNREFUSED' ||
            errCode === 'CONNECT_TIMEOUT' ||
            errCode === 'ETIMEDOUT' ||
            errCode === 'EHOSTUNREACH' ||
            errCode === 'ENETUNREACH' ||
            errMsg.includes('getaddrinfo') ||
            errMsg.includes('connect') ||
            errMsg.includes('TIMEOUT') ||
            errMsg.includes('timeout') ||
            errMsg.includes('socket hang up');

          if (isNetworkError) {
            console.warn('[Offline DB] Postgres server unreachable during transaction. Switching to local JSON database...');
            offlineMode = true;
          } else {
            throw error;
          }
        }
      }

      // SQLite/JSON Transaction
      try {
        const result = await callback(sqlWrapper);
        return result;
      } catch (error) {
        throw error;
      }
    },
  }
);

export const sql: postgres.Sql<{}> = (globalForSql.sql || sqlWrapper) as unknown as postgres.Sql<{}>;

if (process.env.NODE_ENV !== 'production') globalForSql.sql = sql;
