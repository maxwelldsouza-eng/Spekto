import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const APP_BASE = 'https://maxwelldsouza-eng.github.io/Spekto'
const RESEND_FROM = 'Spekto <onboarding@resend.dev>'

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
      recipientFirstName: recipient.first_name ?? recipientName,
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

    let shouldInApp = true
    let shouldEmail = true
    if (!ntConfig.is_mandatory) {
      const { data: pref } = await supabase.from('notification_preferences')
        .select('email_enabled, inapp_enabled').eq('user_id', user_id).eq('type', type).maybeSingle()
      shouldInApp = pref?.inapp_enabled ?? true
      shouldEmail = pref?.email_enabled ?? true
    }
    if (!shouldInApp && !shouldEmail) return

    const message = buildMessage(type, ctx)
    let notifId: string | null = null
    if (shouldInApp) {
      const { data: notif } = await supabase.from('notifications').insert({
        user_id, type, inspection_id: inspection_id ?? null,
        message, is_read: false, email_sent: false,
      }).select('id').single()
      notifId = notif?.id ?? null
    }

    if (!shouldEmail) return

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) { console.warn('[notify] RESEND_API_KEY not set — skipping email'); return }

    const { subject, html } = buildEmail(type, ctx)
    const toAddress = Deno.env.get('RESEND_TO_OVERRIDE') || recipient.email
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: RESEND_FROM, to: toAddress, subject, html }),
    })

    if (!resendRes.ok) console.error('[notify] Resend error:', await resendRes.text().catch(() => ''))

    if (notifId) {
      await supabase.from('notifications').update({
        email_sent: resendRes.ok,
        email_sent_at: resendRes.ok ? new Date().toISOString() : null,
      }).eq('id', notifId)
    }
  } catch (e: unknown) {
    console.error('[notify] Unexpected error:', e instanceof Error ? e.message : String(e))
  }
}

function buildMessage(type: string, ctx: Record<string, string>): string {
  const a = ctx.address, r = ctx.inspectionRef
  switch (type) {
    case 'welcome_client': return `Welcome to Spekto, ${ctx.recipientFirstName}! 👋 You're ready to book your first property inspection — find a Scout in just a few taps.`
    case 'welcome_scout': return `👋 Welcome to Spekto, ${ctx.recipientFirstName}! You're almost ready to start earning. Finish your onboarding steps below to unlock job access and get paid for every inspection you complete.`
    case 'inspection_declined': return `${ctx.scoutName ?? 'Your Scout'} is no longer able to complete your inspection at ${a} (${r}). It's been reposted for other Scouts to pick up — we'll notify you as soon as a new Scout accepts.`
    case 'inspection_cancelled_refund': return `Your inspection at ${a} has been cancelled as requested. A refund of $${ctx.amount ?? '0.00'} is on its way and should appear in your account within 5–10 business days.`
    case 'dispute_received': return `Your dispute for ${a} (${r}) has been received and is now under review. We'll be in touch if we need any more information from you.`
    case 'dispute_resolved_client': return `Your dispute for ${a} (${r}) has been resolved.`
    case 'dispute_resolved_scout': return `The dispute for ${a} (${r}) has been resolved.`
    case 'admin_message': return `You have a new message from Spekto Admin${r ? ` regarding inspection ${r}` : ''}.`
    case 'inspection_accepted': return `🎉 Great news! ${ctx.scoutName ?? 'A Scout'} has accepted your inspection at ${a} (${r}). It's officially on its way to being done!`
    case 'payment_receipt': return `✅ Payment confirmed! Your inspection at ${a} has been booked — $${ctx.amount ?? '0.00'} paid (${r}). We'll notify you as soon as a Scout picks it up.`
    case 'inspection_completed': return `Your inspection at ${a} (${r}) has been completed and is ready to view.`
    case 'payment_released': return `Payment released for your inspection at ${a} (${r}). Expect payout by Tuesday.`
    case 'dispute_raised': return `A dispute has been raised on your inspection at ${a} (${r}). Spekto support is reviewing it and will be in touch — no action needed from you right now.`
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
    case 'welcome_client': {
      subject = `Welcome to Spekto, ${ctx.recipientFirstName}! 👋`
      body = `<p>Welcome to Spekto! We're really glad you're here.</p>
              <p>Spekto connects you with trusted local Scouts who can inspect any property for you and send back a full video walkthrough — so you can make confident decisions without driving across town (or interstate).</p>
              <p><strong>Here's how it works:</strong></p>
              <ol style="padding-left:20px;line-height:2">
                <li><strong>Post an inspection</strong> — tell us the property address and what you need checked</li>
                <li><strong>A Scout picks it up</strong> — and gets to work</li>
                <li><strong>Get your video</strong> — a detailed walkthrough delivered straight to your dashboard</li>
              </ol>
              ${cta('Post Your First Inspection', ctx.newInspectionLink)}
              <p style="margin-top:28px;color:#555">Welcome aboard,<br><strong>The Spekto Team</strong></p>`
      return { subject, html: wrap(ctx.recipientFirstName, body) }
    }
    case 'welcome_scout': {
      subject = `Welcome to Spekto, ${ctx.recipientFirstName} — here's how to get started 👋`
      body = `<p>Welcome to Spekto! We're excited to have you on board as a Scout.</p>
              <p>As a Scout, you'll get paid for every inspection you complete — simply head to a property, capture a video walkthrough, and earn a payout once it's done.</p>
              <p>Before you can start accepting jobs, there are 4 quick steps to complete:</p>
              <ol style="padding-left:20px;line-height:2">
                <li><strong>Identity verification</strong> — upload your passport or driver's licence for review</li>
                <li><strong>Right to work check</strong> — verify your right to work in Australia</li>
                <li><strong>Stripe payout setup</strong> — connect your bank account to receive weekly payouts</li>
                <li><strong>Home address</strong> — set your address so we can show you nearby jobs</li>
              </ol>
              <p>Once these are done, you're all set — jobs in your area will start showing up, and you can begin earning straight away.</p>
              ${cta('Complete Onboarding', ctx.onboardingLink)}
              <p style="margin-top:28px;color:#555">Welcome aboard,<br><strong>The Spekto Team</strong></p>`
      return { subject, html: wrap(ctx.recipientFirstName, body) }
    }
    case 'inspection_declined': {
      const formattedDate = ctx.inspectionDate ? ctx.inspectionDate.split('-').reverse().join('/') : ''
      subject = `Update on your inspection (${ctx.inspectionRef}) — finding you a new Scout`
      body = `<p>We wanted to let you know that ${ctx.scoutName ?? 'your Scout'} is no longer able to complete your inspection.</p>
              <p>Don't worry — this happens occasionally, and we've already taken care of it. Your inspection has been reposted and is now visible to other available Scouts in the area.</p>
              <p><strong>Here's what happens next:</strong></p>
              <ul style="padding-left:20px;line-height:2">
                <li>Your inspection is back on the board — other Scouts nearby can now accept it</li>
                <li>You'll be notified the moment someone accepts — just like before</li>
                <li>The rest of the process continues as normal — once accepted, your Scout will head to the property and capture your video walkthrough</li>
              </ul>
              <p>There's nothing you need to do right now — we're on it.</p>
              ${table([['Reference', ctx.inspectionRef], ['Address', ctx.address], ['Date', formattedDate]])}
              ${cta('View Inspection', ctx.inspectionLink)}
              <p style="margin-top:28px;color:#555">Thanks for your patience,<br><strong>The Spekto Team</strong></p>`
      return { subject, html: wrap(ctx.recipientFirstName, body) }
    }
    case 'inspection_cancelled_refund': {
      subject = `Cancellation confirmed — your refund is on its way (${ctx.inspectionRef})`
      body = `<p>Your inspection has been cancelled as requested, and we've processed your refund.</p>
              ${table([['Reference', ctx.inspectionRef], ['Address', ctx.address], ['Amount refunded', `\$${ctx.amount ?? '0.00'}`]])}
              <p>Your refund has been sent back to your original payment method and typically takes 5–10 business days to appear, depending on your bank.</p>
              <p>If you'd like to book another inspection in the future, we're always here whenever you're ready.</p>
              ${cta('View Inspection', ctx.inspectionLink)}
              <p style="margin-top:28px;color:#555">Thanks for using Spekto,<br><strong>The Spekto Team</strong></p>`
      return { subject, html: wrap(ctx.recipientFirstName, body) }
    }
    case 'dispute_received': {
      subject = `We've received your dispute (${ctx.inspectionRef})`
      body = `<p>Thanks for letting us know — we've received your dispute and our team is now reviewing it.</p>
              <p><strong>Here's what happens next:</strong></p>
              <ul style="padding-left:20px;line-height:2">
                <li><strong>Our team reviews the inspection</strong> — we'll take a close look at the video walkthrough and the details of your dispute</li>
                <li><strong>We may message you with questions</strong> — if we need more information, we'll send you a message directly on your inspection. You'll get an email notification letting you know a new message is waiting, so keep an eye on your inbox</li>
                <li><strong>We'll let you know the outcome</strong> — once our review is complete, we'll follow up with next steps</li>
              </ul>
              <p>To reply or view any messages, just head to your inspection in the app — that's where all communication about your dispute will happen.</p>
              ${table([['Reference', ctx.inspectionRef], ['Address', ctx.address]])}
              ${cta('View Dispute', ctx.disputeLink)}
              <p style="margin-top:28px;color:#555">Thanks for your patience while we look into this,<br><strong>The Spekto Team</strong></p>`
      return { subject, html: wrap(ctx.recipientFirstName, body) }
    }
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
    case 'inspection_accepted': {
      const scoutFirst = ctx.scoutName?.split(' ')[0] ?? 'Your Scout'
      const formattedDate = ctx.inspectionDate ? ctx.inspectionDate.split('-').reverse().join('/') : ''
      subject = `Your inspection has been accepted — here's what happens next 🎉`
      body = `<p>Good news — ${ctx.scoutName ?? 'a Scout'} has accepted your inspection request!</p>
              <p><strong>Here's what happens next:</strong></p>
              <ol style="padding-left:20px;line-height:2">
                <li><strong>${scoutFirst} heads to the property</strong> — at the scheduled date and time below</li>
                <li><strong>They capture a full video walkthrough</strong> — covering everything you need to see</li>
                <li><strong>Your video lands in your dashboard</strong> — and we'll let you know the moment it's ready</li>
              </ol>
              <p>You don't need to do anything else for now — just sit back, and we'll keep you posted every step of the way.</p>
              ${table([['Reference', ctx.inspectionRef], ['Address', ctx.address], ['Date', formattedDate], ['Time', ctx.inspectionTime]])}
              ${cta('View Inspection', ctx.inspectionLink)}
              <p style="margin-top:28px;color:#555">Thanks for using Spekto,<br><strong>The Spekto Team</strong></p>`
      return { subject, html: wrap(ctx.recipientFirstName, body) }
    }
    case 'payment_receipt': {
      subject = `Your inspection is booked — here's what happens next 🎉`
      body = `<p>Great news — we've received your inspection request and your payment has gone through successfully.</p>
              <p><strong>Here's what happens next:</strong></p>
              <ol style="padding-left:20px;line-height:2">
                <li><strong>A Scout picks it up</strong> — usually a local Scout in the area will accept your job</li>
                <li><strong>They head to the property</strong> — and capture a full video walkthrough</li>
                <li><strong>You get notified</strong> — as soon as your video is ready, we'll let you know</li>
              </ol>
              <p>You don't need to do anything else for now — we'll keep you posted every step of the way.</p>
              ${table([['Reference', ctx.inspectionRef], ['Address', ctx.address], ['Date', ctx.inspectionDate], ['Amount paid', `$${ctx.amount ?? '0.00'}`], ...(ctx.receipt_number ? [['Receipt no.', ctx.receipt_number] as [string, string]] : [])])}
              <p style="color:#666;font-size:13px">Thank you for using Spekto.</p>
              ${cta('View Inspection', ctx.inspectionLink)}`
      return { subject, html: wrap(ctx.recipientFirstName, body) }
    }
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
    case 'dispute_raised': {
      subject = `A dispute has been raised on your inspection (${ctx.inspectionRef})`
      body = `<p>A client has raised a dispute on one of your inspections. We wanted to let you know straight away.</p>
              <p>This is a normal part of the process, and our team will take it from here.</p>
              <p><strong>Here's what happens next:</strong></p>
              <ul style="padding-left:20px;line-height:2">
                <li><strong>Our team reviews the inspection</strong> — we'll take a close look at the video walkthrough and the details of the dispute</li>
                <li><strong>We may message you with questions</strong> — if we need more information from you, we'll send you a message directly on your inspection. You'll get an email notification letting you know a new message is waiting, so keep an eye on your inbox</li>
                <li><strong>We'll let you know the outcome</strong> — once our review is complete, we'll follow up with next steps</li>
              </ul>
              <p>To view any messages or check on your inspection, just log in to Spekto and open this inspection — that's where all communication about this dispute will happen.</p>
              ${table([['Reference', ctx.inspectionRef], ['Address', ctx.address]])}
              ${cta('View Inspection', ctx.scoutInspectionLink)}
              <p style="margin-top:28px;color:#555">Thanks for your patience while we look into this,<br><strong>The Spekto Team</strong></p>`
      return { subject, html: wrap(ctx.recipientFirstName, body) }
    }
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
</td></tr>
</table></td></tr>
</table></body></html>`
}
