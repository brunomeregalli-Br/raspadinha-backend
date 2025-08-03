import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { supabase } from './supabase.js';
import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

const ADMIN_EMAIL = 'flexinonetrap@gmail.com';
const ADMIN_PASSWORD = '123';
const VALORES = [10,20,30,50,100,500];

let accessToken = '';
const CLIENT_ID = process.env.GERENCIANET_CLIENT_ID;
const CLIENT_SECRET = process.env.GERENCIANET_CLIENT_SECRET;
const PIX_KEY = process.env.GERENCIANET_PIX_KEY;

async function getAccessToken() {
  const body = new URLSearchParams();
  body.append('grant_type','client_credentials');
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await axios.post('https://api.gerencianet.com.br/v1/authorize', body, {
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  accessToken = res.data.access_token;
}

// Depósito Pix
app.post('/pix/depositar', async (req,res)=>{
  const { user_id, valor } = req.body;
  if(!VALORES.includes(valor)) return res.status(400).json({ error:'Valor inválido' });
  if (!accessToken) await getAccessToken();
  const txid = crypto.randomUUID().slice(0,35);
  const payload = {
    calendario: { expiracao:3600 },
    valor: { original: valor.toFixed(2) },
    chave: PIX_KEY,
    solicitacaoPagador:'Depósito via raspadinha'
  };
  const { data } = await axios.put(`https://api.gerencianet.com.br/v2/cob/${txid}`, payload, { headers:{ Authorization:`Bearer ${accessToken}` }});
  const qrRes = await axios.get(`https://api.gerencianet.com.br/v2/loc/${data.loc.id}/qrcode`, {
    headers:{ Authorization:`Bearer ${accessToken}` }
  });
  await supabase.from('transacoes').insert({ user_id, txid, valor, tipo:'deposito' });
  res.json({ qr_code: qrRes.data.imagemQrcode, txid });
});

// Webhook Pix
app.post('/pix/webhook', async (req,res)=>{
  const pix = req.body.pix?.[0];
  if(!pix){ res.sendStatus(200); return; }
  const { txid, valor, infoAdicionais } = pix;
  const userId = infoAdicionais?.find(i=>i.nome==='user_id')?.valor;
  if(!userId){ res.sendStatus(200); return; }
  const already = await supabase.from('transacoes').select().eq('txid',txid).single();
  if(already.data){ res.send('Já processado'); return; }
  await supabase.from('transacoes').insert({ user_id:userId, txid, valor:parseFloat(valor), tipo:'deposito'});
  res.send('OK');
});

// Admin login
app.post('/admin/login', (req,res)=>{
  const { email, senha } = req.body;
  if(email===ADMIN_EMAIL && senha===ADMIN_PASSWORD) res.json({ autorizado:true });
  else res.status(401).json({ autorizado:false });
});

// Admin dados
app.get('/admin/saldo', async (req,res)=>{
  const { data } = await supabase.rpc('get_admin_saldo_ranking');
  res.json(data);
});

app.listen(port, ()=> console.log(`Backend rodando em http://localhost:${port}`));
