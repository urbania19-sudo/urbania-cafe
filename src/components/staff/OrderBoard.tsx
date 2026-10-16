'use client';

import { useEffect,useState } from 'react';
import { useRouter } from 'next/navigation';

type Order={id:string;order_number:number;status:string;customer_name:string|null;guest_count:number|null;total_paise:number;created_at:string;cafe_tables:{label:string}|null;order_items:{item_name_snapshot:string;quantity:number}[]};
const next:Record<string,string|undefined>={NEW:'ACCEPTED',ACCEPTED:'PREPARING',PREPARING:'READY',READY:'COMPLETED'};
const action:Record<string,string>={NEW:'Accept order',ACCEPTED:'Start preparing',PREPARING:'Mark ready',READY:'Mark completed'};

export default function OrderBoard({initial}:{initial:Order[]}){
  const router=useRouter();
  const [statusById,setStatusById]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState<string>();
  const [error,setError]=useState('');
  const orders=initial.map(order=>({...order,status:statusById[order.id]??order.status}));

  useEffect(()=>{const timer=window.setInterval(()=>router.refresh(),15000);return()=>window.clearInterval(timer)},[router]);

  async function advance(o:Order){
    const status=next[o.status];
    if(!status)return;
    setBusy(o.id);setError('');
    const r=await fetch(`/api/staff/orders/${o.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({status})});
    if(r.ok){setStatusById(v=>({...v,[o.id]:status}));router.refresh()}
    else setError('Could not update this order. Refresh and try again.');
    setBusy(undefined);
  }

  if(!orders.length)return <section className="card" style={{padding:'clamp(28px,6vw,52px)',textAlign:'center'}}><div aria-hidden style={{fontSize:34,marginBottom:8}}>☕</div><h2 style={{fontFamily:'Georgia,serif',margin:'0 0 8px'}}>Waiting for the first order</h2><p className="muted" style={{maxWidth:420,margin:'auto'}}>This queue checks for new table orders every 15 seconds.</p></section>;
  return <section style={{display:'grid',gap:12}}>{error&&<p role="alert" style={{padding:12,borderLeft:'3px solid #df6d5d'}}>{error}</p>}{orders.map(o=>{const following=next[o.status];return <article className="card" key={o.id} style={{padding:18}}><div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'start'}}><div><span style={{color:'var(--accent)',fontSize:12,letterSpacing:'.12em'}}>TABLE · {o.cafe_tables?.label??'Unknown'}</span><h2 style={{fontFamily:'Georgia,serif',margin:'5px 0'}}>Order #{o.order_number}</h2><p className="muted" style={{margin:'0 0 4px'}}>{o.customer_name||'Guest'} · {o.guest_count??1} {o.guest_count===1?'person':'people'}</p></div><span className="chip" style={{color:'var(--accent)'}}>{o.status}</span></div><ul className="muted" style={{paddingLeft:20,lineHeight:1.7}}>{o.order_items.map((i,n)=><li key={n}>{i.quantity}× {i.item_name_snapshot}</li>)}</ul><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,borderTop:'1px solid var(--line)',paddingTop:14}}><b>₹{(o.total_paise/100).toFixed(2)}</b>{following&&<button className="btn" disabled={busy===o.id} onClick={()=>advance(o)}>{busy===o.id?'Updating…':action[o.status]}</button>}</div></article>})}</section>;
}
