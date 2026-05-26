import { Metadata } from 'next';
import Breadcrumbs from '@/app/ui/invoices/breadcrumbs';
import CreateCustomerForm from '@/app/ui/customers/create-form';

export const metadata: Metadata = {
  title: 'Create Customer | Acme Dashboard',
  description: 'Add a new customer to your Acme dashboard to manage their transactions and invoices.',
};

export default async function Page() {
  return (
    <main>
      <Breadcrumbs
        breadcrumbs={[
          { label: 'Customers', href: '/dashboard/customers' },
          {
            label: 'Create Customer',
            href: '/dashboard/customers/create',
            active: true,
          },
        ]}
      />
      <CreateCustomerForm />
    </main>
  );
}
