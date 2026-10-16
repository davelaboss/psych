import Link from 'next/link';
import { AdminDashboard } from '@/components/admin-dashboard';
import { ReviewerAccessForm } from '@/components/reviewer-access-form';
import { chatGPTSignInPath } from '@/app/chatgpt-auth';
import { getAdminSession } from '@/lib/admin-auth';
import { AdminLanguageShell } from '@/components/admin-language';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Panel vendedor | Venta de Mudanza', robots: { index: false, follow: false } };

export default async function AdminPage() {
  const session = await getAdminSession();
  if (!session) {
    return <AdminLanguageShell preferenceKey="access-screen" defaultLanguage="es"><main className="reviewer-login">
      <section>
        <span className="section-kicker">REVISIÓN PRIVADA</span>
        <h1>Acceso al inventario</h1>
        <p>María puede ingresar el código de un solo uso entregado por el propietario. No necesita una cuenta de ChatGPT.</p>
        <ReviewerAccessForm />
        <p className="reviewer-privacy">El inventario real, las fotos y el contenido del panel no están disponibles sin autorización.</p>
        <a
          className="reviewer-owner-link"
          href={chatGPTSignInPath('/admin')}
          target="_top"
        >
          Ingreso del propietario con ChatGPT
        </a>
        <Link href="/">Volver a Venta próximamente</Link>
      </section>
    </main></AdminLanguageShell>;
  }
  return <AdminLanguageShell preferenceKey={session.user.userId} defaultLanguage={session.role === 'OWNER' ? 'en' : 'es'}><AdminDashboard
    sellerName={session.user.displayName}
    sellerEmail={session.role === 'REVIEWER' ? 'Sesión segura de María' : session.user.email}
    role={session.role}
  /></AdminLanguageShell>;
}
