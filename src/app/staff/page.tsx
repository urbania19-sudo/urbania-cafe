import { redirect } from 'next/navigation';
import { authDb } from '@/lib/supabase/auth-server';
import LogoutButton from '@/components/auth/LogoutButton';
import OrderBoard from '@/components/staff/OrderBoard';

export const dynamic='force-dynamic';

export default async function Staff(){
  const db=await authDb();
  const {data:{user}}=await db.auth.getUser();
  if(!user)redirect('/staff/login');
  const {data:profile}=await db.from('admin_profiles').select('role').eq('user_id',user.id).maybeSingle();
  if(!profile)redirect('/staff/login');
  const {data,error}=await db.from('orders').select('id,order_number,status,customer_name,guest_count,total_paise,created_at,cafe_tables(label),order_items(item_name_snapshot,quantity)').in('status',['NEW','ACCEPTED','PREPARING','READY']).order('created_at');
  const orders=(data??[]) as never[];

  return <main className="shell" style={{maxWidth:1060,paddingTop:32}}>
    <header style={{display:'flex',justifyContent:'space-between',gap:20,alignItems:'flex-start',flexWrap:'wrap',paddingBottom:24,borderBottom:'1px solid var(--line)'}}>
      <div><p style={{color:'var(--accent)',fontSize:12,letterSpacing:'.16em',textTransform:'uppercase',margin:'0 0 8px'}}>Staff portal · live queue</p><h1 style={{fontFamily:'Georgia,serif',fontSize:'clamp(2.1rem,5vw,3.4rem)',margin:0,lineHeight:.95}}>Orders to prepare</h1><p className="muted" style={{marginBottom:0}}>New table orders arrive here automatically.</p></div>
      <div style={{display:'flex',gap:10,alignItems:'center'}}><span className="chip" style={{color:'var(--accent)'}}>{orders.length} active</span><LogoutButton to="/staff/login"/></div>
    </header>
    <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:10,padding:'18px 0'}}>{[['1','New','Accept incoming order'],['2','Preparing','Start making it'],['3','Ready','Take it to the table'],['4','Completed','Close the ticket']].map(([n,label,info])=><div className="card" style={{padding:14}} key={n}><span style={{color:'var(--accent)',fontSize:12,fontWeight:800}}>STEP {n}</span><b style={{display:'block',margin:'7px 0 4px'}}>{label}</b><small className="muted">{info}</small></div>)}</section>
    {error?<section className="card" role="alert" style={{padding:18,borderLeft:'3px solid #df6d5d'}}><b>Orders could not be loaded.</b><p className="muted" style={{marginBottom:0}}>Refresh once. If this continues after deployment, run the pending Supabase database migration.</p></section>:<OrderBoard initial={orders}/>} 
  </main>;
}
