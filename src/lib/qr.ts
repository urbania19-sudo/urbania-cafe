import QRCode from 'qrcode';
export function tableUrl(token:string){const base=process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/,'');if(!base)throw new Error('NEXT_PUBLIC_SITE_URL is required');return `${base}/menu/${token}`;}
export const tableQrSvg=(token:string)=>QRCode.toString(tableUrl(token),{type:'svg',errorCorrectionLevel:'M',margin:4,width:1000});
