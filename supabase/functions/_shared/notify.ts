import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const APP_BASE = 'https://maxwelldsouza-eng.github.io/Spekto'
const RESEND_FROM = 'Spekto <notifications@spekto.com.au>'

export interface NotifyInput {
  user_id: string
  type: string
  inspection_id?: string
  extra?: Record<string, string>
}

export async function sendNotification(supabase: SupabaseClient, input: NotifyInput): Promise<void> {
  const { user_id, type, inspection_id, extra = {} } = input
  try {
    const { data: ntConfig } = await supabase
      .from('notification_types').select('is_mandatory').eq('type', type).single()
    if (!ntConfig) { console.error(`[notify] Unknown type: ${type}`); return }

    const { data: recipient } = await supabase
      .from('users').select('email, first_name, last_name').eq('id', user_id).single()
    if (!recipient?.email) { console.error(`[notify] Recipient not found: ${user_id}`); return }

    const recipientName = `${recipient.first_name ?? ''} ${recipient.last_name ?? ''}`.trim() || recipient.email

    let inspection: Record<string, string> | null = null
    if (inspection_id) {
      const { data } = await supabase
        .from('inspections').select('id, address, date, time, ref_number, client_id, scout_id')
        .eq('id', inspection_id).single()
      inspection = data
    }

    const ctx: Record<string, string> = {
      recipientName,
      address: inspection?.address ?? extra.address ?? '',
      inspectionRef: extra.inspection_ref ?? (inspection?.ref_number ? `#${inspection.ref_number}` : ''),
      inspectionDate: extra.inspection_date ?? inspection?.date ?? '',
      inspectionTime: extra.inspection_time ?? (inspection?.time ? String(inspection.time).slice(0, 5) : ''),
      inspectionLink: inspection ? `${APP_BASE}/client/inspection-detail.html?id=${inspection.id}` : '',
      scoutInspectionLink: inspection ? `${APP_BASE}/scout/inspection-detail.html?id=${inspection.id}` : '',
      disputeLink: `${APP_BASE}/client/disputes.html`,
      onboardingLink: `${APP_BASE}/scout/settings.html`,
      newInspectionLink: `${APP_BASE}/client/new-inspection.html`,
      ...extra,
    }

    if (inspection?.client_id && inspection.client_id !== user_id && !ctx.clientName) {
      const { data: c } = await supabase.from('users').select('first_name, last_name').eq('id', inspection.client_id).single()
      if (c) ctx.clientName = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()
    }
    if (inspection?.scout_id && inspection.scout_id !== user_id && !ctx.scoutName) {
      const { data: s } = await supabase.from('users').select('first_name, last_name').eq('id', inspection.scout_id).single()
      if (s) ctx.scoutName = `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim()
    }

    const message = buildMessage(type, ctx)

    const { data: notif } = await supabase.from('notifications').insert({
      user_id, type, inspection_id: inspection_id ?? null,
      message, is_read: false, email_sent: false,
    }).select('id').single()

    let shouldEmail = ntConfig.is_mandatory
    if (!shouldEmail) {
      const { data: pref } = await supabase.from('notification_preferences')
        .select('email_enabled').eq('user_id', user_id).eq('type', type).maybeSingle()
      shouldEmail = pref?.email_enabled ?? true
    }
    if (!shouldEmail) return

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) { console.warn('[notify] RESEND_API_KEY not set — skipping email'); return }

    const { subject, html } = buildEmail(type, ctx)
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: RESEND_FROM, to: recipient.email, subject, html }),
    })

    if (!resendRes.ok) console.error('[notify] Resend error:', await resendRes.text().catch(() => ''))

    if (notif?.id) {
      await supabase.from('notifications').update({
        email_sent: resendRes.ok,
        email_sent_at: resendRes.ok ? new Date().toISOString() : null,
      }).eq('id', notif.id)
    }
  } catch (e: unknown) {
    console.error('[notify] Unexpected error:', e instanceof Error ? e.message : String(e))
  }
}

function buildMessage(type: string, ctx: Record<string, string>): string {
  const a = ctx.address, r = ctx.inspectionRef
  switch (type) {
    case 'welcome_client': return `Welcome to Spekto, ${ctx.recipientName}!`
    case 'welcome_scout': return `Welcome to Spekto, ${ctx.recipientName}! Complete your onboarding to start accepting jobs.`
    case 'inspection_declined': return `${ctx.scoutName ?? 'Your Scout'} is no longer able to complete your inspection at ${a}. We're finding you a new Scout.`
    case 'inspection_cancelled_refund': return `Your inspection at ${a} has been cancelled. A refund of $${ctx.amount ?? '0.00'} is on its way.`
    case 'dispute_received': return `Your dispute for ${a} (${r}) has been received and is under review.`
    case 'dispute_resolved_client': return `Your dispute for ${a} (${r}) has been resolved.`
    case 'dispute_resolved_scout': return `The dispute for ${a} (${r}) has been resolved.`
    case 'admin_message': return `You have a new message from Spekto Admin${r ? ` regarding inspection ${r}` : ''}.`
    case 'inspection_accepted': return `Your inspection at ${a} (${r}) has been accepted by ${ctx.scoutName ?? 'a Scout'}.`
    case 'payment_receipt': return `Payment of $${ctx.amount ?? '0.00'} confirmed for your inspection at ${a} (${r}).`
    case 'inspection_completed': return `Your inspection at ${a} (${r}) has been completed and is ready to view.`
    case 'payment_released': return `Payment released for your inspection at ${a} (${r}). Expect payout by Tuesday.`
    case 'dispute_raised': return `A dispute has been raised on your inspection at ${a}. Spekto support will be in touch.`
    default: return 'You have a new notification from Spekto.'
  }
}

function buildEmail(type: string, ctx: Record<string, string>): { subject: string; html: string } {
  const cta = (text: string, url: string) =>
    url ? `<a href="${url}" style="display:inline-block;background:#560591;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;margin-top:20px">${text}</a>` : ''
  const table = (rows: [string, string][]) =>
    `<table style="width:100%;border-collapse:collapse;margin:16px 0;background:#F7F5FA;border-radius:8px;overflow:hidden">${
      rows.filter(([, v]) => v).map(([l, v]) =>
        `<tr><td style="padding:10px 14px;font-size:12px;color:#666;width:140px;border-bottom:1px solid #EEEBF4;white-space:nowrap">${l}</td><td style="padding:10px 14px;font-size:13px;color:#0D0D0D;font-weight:600;border-bottom:1px solid #EEEBF4">${v}</td></tr>`
      ).join('')
    }</table>`

  let subject = '', body = ''
  switch (type) {
    case 'welcome_client':
      subject = `Welcome to Spekto, ${ctx.recipientName}`
      body = `<p>Thanks for joining Spekto. We connect you with verified Scouts who can carry out property inspections on your behalf.</p>
              <ul style="padding-left:20px;line-height:2"><li>Post an inspection for any property</li><li>Get matched with a nearby verified Scout</li><li>Receive a full video walkthrough</li><li>Track everything from your dashboard</li></ul>
              ${cta('Post Your First Inspection', ctx.newInspectionLink)}`
      break
    case 'welcome_scout':
      subject = `Welcome to Spekto — complete your onboarding to start earning`
      body = `<p>Thanks for joining Spekto as a Scout. You'll earn a payout for every inspection you complete.</p>
              <p>Before accepting jobs, finish these 4 steps:</p>
              <ol style="padding-left:20px;line-height:2"><li>Identity verification</li><li>Right to work verification</li><li>Home address</li><li>Connect your bank account via Stripe</li></ol>
              ${cta('Complete Onboarding', ctx.onboardingLink)}`
      break
    case 'inspection_declined':
      subject = `Update on your inspection (${ctx.inspectionRef}) — reassigning your Scout`
      body = `<p>${ctx.scoutName ?? 'Your Scout'} is no longer able to complete your inspection. We're finding you another Scout — no action needed.</p>
              ${table([['Reference', ctx.inspectionRef], ['Address', ctx.address], ['Date', ctx.inspectionDate]])}
              ${cta('View Inspection', ctx.inspectionLink)}`
      break
    case 'inspection_cancelled_refund':
      subject = `Cancellation confirmed — refund processed (${ctx.inspectionRef})`
      body = `<p>Your inspection has been cancelled as requested.</p>
              ${table([['Reference', ctx.inspectionRef], ['Address', ctx.address], ['Amount refunded', `$${ctx.amount ?? '0.00'}`], ...(ctx.payment_method_last4 ? [['Payment method', `···· ${ctx.payment_method_last4}`] as [string, string]] : [])])}
              <p style="color:#666;font-size:13px">Refunds typically appear within 5–10 business days.</p>
              ${cta('View Inspection', ctx.inspectionLink)}`
      break
    case 'dispute_received':
      subject = `We've received your dispute (${ctx.inspectionRef})`
      body = `<p>We've received your dispute and our team will review it within 48 hours.</p>
              ${table([['Reference', ctx.inspectionRef], ['Address', ctx.address], ...(ctx.dispute_reason ? [['Reason', ctx.dispute_reason] as [string, string]] : [])])}
              ${cta('View Dispute', ctx.disputeLink)}`
      break
    case 'dispute_resolved_client':
      subject = `Your dispute has been resolved (${ctx.inspectionRef})`
      body = `<p>Your dispute has been reviewed and resolved.</p>
              ${table([['Reference', ctx.inspectionRef], ['Address', ctx.address], ...(ctx.decision_text ? [['Decision', ctx.decision_text] as [string, string]] : [])])}
              ${cta('View Details', ctx.disputeLink)}`
      break
    case 'dispute_resolved_scout':
      subject = `Dispute resolution (${ctx.inspectionRef}) — ${ctx.address}`
      body = `<p>The dispute relating to your inspection has been resolved.</p>
              ${table([['Reference', ctx.inspectionRef], ['Address', ctx.address], ...(ctx.decision_text ? [['Decision', ctx.decision_text] as [string, string]] : [])])}
              ${cta('View Details', ctx.scoutInspectionLink)}`
      break
    case 'admin_message':
      subject = `New message from Spekto Admin${ctx.inspectionRef ? ` (${ctx.inspectionRef})` : ''}`
      body = `<p>Spekto Admin has sent you a message${ctx.inspectionRef ? ` regarding inspection ${ctx.inspectionRef} — ${ctx.address}` : ''}.</p>
              ${ctx.message_text ? `<div style="background:#F5EEFF;border-left:3px solid #560591;border-radius:0 8px 8px 0;padding:12px 16px;margin:16px 0;font-size:14px;color:#333;line-height:1.6">${ctx.message_text}</div>` : ''}
              ${cta('View Message', ctx.inspectionLink || ctx.disputeLink)}`
      break
    case 'inspection_accepted':
      subject = `Your inspection has been accepted (${ctx.inspectionRef})`
      body = `<p>Good news — ${ctx.scoutName ?? 'a Scout'} has accepted your inspection.</p>
              ${table([['Reference', ctx.inspectionRef], ['Address', ctx.address], ['Date', ctx.inspectionDate], ['Time', ctx.inspectionTime]])}
              ${cta('View Inspection', ctx.inspectionLink)}`
      break
    case 'payment_receipt':
      subject = `Receipt — Spekto Inspection Payment (${ctx.inspectionRef})`
      body = `<p>This confirms your payment for the following inspection:</p>
              ${table([['Reference', ctx.inspectionRef], ['Address', ctx.address], ['Date', ctx.inspectionDate], ['Amount paid', `$${ctx.amount ?? '0.00'}`], ...(ctx.payment_method_last4 ? [['Payment method', `···· ${ctx.payment_method_last4}`] as [string, string]] : []), ...(ctx.receipt_number ? [['Receipt no.', ctx.receipt_number] as [string, string]] : [])])}
              <p style="color:#666;font-size:13px">Thank you for using Spekto.</p>
              ${cta('View Inspection', ctx.inspectionLink)}`
      break
    case 'inspection_completed':
      subject = `Your inspection is complete (${ctx.inspectionRef})`
      body = `<p>${ctx.scoutName ?? 'Your Scout'} has completed your inspection. The video and report are ready to view.</p>
              ${table([['Reference', ctx.inspectionRef], ['Address', ctx.address]])}
              ${cta('View Report', ctx.inspectionLink)}`
      break
    case 'payment_released':
      subject = `Payment released (${ctx.inspectionRef}) — ${ctx.address}`
      body = `<p>${ctx.clientName ?? 'The client'} has released payment for your completed inspection.</p>
              ${table([['Reference', ctx.inspectionRef], ['Address', ctx.address], ['Amount', `$${ctx.scout_payout_amount ?? '0.00'}`], ['Expected payout', ctx.payout_date ?? 'Next Tuesday']])}
              <p style="color:#666;font-size:13px">Payouts are processed each Tuesday.</p>
              ${cta('View Inspection', ctx.scoutInspectionLink)}`
      break
    case 'dispute_raised':
      subject = `A dispute has been raised on your inspection (${ctx.inspectionRef})`
      body = `<p>A client has raised a dispute on your inspection. Spekto support will review it and be in touch.</p>
              ${table([['Reference', ctx.inspectionRef], ['Address', ctx.address]])}
              ${cta('View Inspection', ctx.scoutInspectionLink)}`
      break
    default:
      subject = 'A new notification from Spekto'
      body = '<p>You have a new notification from Spekto.</p>'
  }

  return { subject, html: wrap(ctx.recipientName, body) }
}

function wrap(name: string, content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F5FA;font-family:Inter,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F5FA;padding:32px 16px">
<tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="background:#560591;border-radius:12px 12px 0 0;padding:20px 28px">
  <span style="font-family:'DM Sans',Arial,sans-serif;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px">Spekto</span>
</td></tr>
<tr><td style="background:#fff;padding:28px 32px;border-radius:0 0 12px 12px">
  <p style="margin:0 0 16px;font-size:15px;color:#0D0D0D;font-weight:600">Hi ${name},</p>
  <div style="font-size:14px;color:#444;line-height:1.7">${content}</div>
  <hr style="border:none;border-top:1px solid #F3F3F3;margin:28px 0 16px">
  <p style="margin:0;font-size:12px;color:#aaa">You're receiving this from Spekto. For help, reply to this email or contact support.</p>
</td></tr>
</table></td></tr>
</table></body></html>`
}
