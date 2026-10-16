export type PriceLine={unitPricePaise:number;quantity:number; optionPricePaise?:number};
export function calculateLineTotal({unitPricePaise,quantity,optionPricePaise=0}:PriceLine){if(!Number.isInteger(unitPricePaise)||!Number.isInteger(optionPricePaise)||!Number.isInteger(quantity)||quantity<1||quantity>20)throw new Error('Invalid price or quantity'); return (unitPricePaise+optionPricePaise)*quantity;}
export const formatINR=(paise:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(paise/100);
