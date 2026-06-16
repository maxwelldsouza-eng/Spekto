import { supabase } from '../config/supabase-config.js'

// ============================================
// PRICING FUNCTIONS
// ============================================

let pricingCache = null

export async function getPricing() {
  if (pricingCache) return pricingCache
  try {
    const { data, error } = await supabase
      .from('pricing')
      .select('*')
      .eq('active', true)
    if (error) throw error
    pricingCache = {}
    data.forEach(row => { pricingCache[row.id] = row })
    return pricingCache
  } catch (error) {
    console.error('getPricing error:', error)
    return null
  }
}

export async function getPricingByType(typeId) {
  const pricing = await getPricing()
  return pricing ? pricing[typeId] : null
}

// ============================================
// USER FUNCTIONS
// ============================================

export async function createUser(uid, firstName, lastName, email, role) {
  try {
    const { data, error } = await supabase
      .from('users')
      .insert({
        id: uid,
        first_name: firstName,
        last_name: lastName,
        email: email,
        role: role,
        active_role: role,
        is_email_verified: false,
        is_active: true
      })
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('createUser error:', error)
    return { success: false, error }
  }
}

export async function getUserById(uid) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', uid)
      .single()
    if (error) throw error
    return data
  } catch (error) {
    console.error('getUserById error:', error)
    return null
  }
}

export async function updateUserActiveRole(uid, role) {
  try {
    const { data, error } = await supabase
      .from('users')
      .update({
        active_role: role,
        updated_at: new Date().toISOString()
      })
      .eq('id', uid)
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('updateUserActiveRole error:', error)
    return { success: false, error }
  }
}

export async function updateUserProfile(uid, firstName, lastName, phoneNumber) {
  try {
    const { data, error } = await supabase
      .from('users')
      .update({
        first_name: firstName,
        last_name: lastName,
        phone_number: phoneNumber || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', uid)
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('updateUserProfile error:', error)
    return { success: false, error }
  }
}

export async function verifyUserEmail(uid) {
  try {
    const { data, error } = await supabase
      .from('users')
      .update({
        is_email_verified: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', uid)
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('verifyUserEmail error:', error)
    return { success: false, error }
  }
}

export async function getUserByEmail(email) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single()
    if (error) throw error
    return data
  } catch (error) {
    console.error('getUserByEmail error:', error)
    return null
  }
}

// ============================================
// CLIENT PROFILE FUNCTIONS
// ============================================

export async function createClientProfile(userId) {
  try {
    const { data, error } = await supabase
      .from('client_profiles')
      .insert({
        user_id: userId,
        notification_email: true,
        notification_in_app: true
      })
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('createClientProfile error:', error)
    return { success: false, error }
  }
}

export async function updateClientProfile(
  userId, companyName, abn,
  billingAddress, billingSuburb,
  billingState, billingPostcode
) {
  try {
    const { data, error } = await supabase
      .from('client_profiles')
      .update({
        company_name: companyName || null,
        abn: abn || null,
        billing_address: billingAddress || null,
        billing_suburb: billingSuburb || null,
        billing_state: billingState || null,
        billing_postcode: billingPostcode || null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('updateClientProfile error:', error)
    return { success: false, error }
  }
}

export async function getClientProfile(userId) {
  try {
    const { data, error } = await supabase
      .from('client_profiles')
      .select('*')
      .eq('user_id', userId)
      .single()
    if (error) throw error
    return data
  } catch (error) {
    console.error('getClientProfile error:', error)
    return null
  }
}

// ============================================
// SCOUT PROFILE FUNCTIONS
// ============================================

export async function createScoutProfile(userId) {
  try {
    const { data, error } = await supabase
      .from('scout_profiles')
      .insert({
        user_id: userId,
        scout_status: 'PendingVerification',
        total_completions: 0,
        notification_email: true,
        notification_in_app: true
      })
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('createScoutProfile error:', error)
    return { success: false, error }
  }
}

export async function updateScoutProfile(
  userId, dateOfBirth, abn,
  serviceAreas, phoneNumber
) {
  try {
    const { data, error } = await supabase
      .from('scout_profiles')
      .update({
        date_of_birth: dateOfBirth || null,
        abn: abn || null,
        service_areas: serviceAreas || null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('updateScoutProfile error:', error)
    return { success: false, error }
  }
}

export async function uploadScoutIdDocument(userId, idType, idDocumentUrl) {
  try {
    const { data, error } = await supabase
      .from('scout_profiles')
      .update({
        id_type: idType,
        id_document_url: idDocumentUrl,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('uploadScoutIdDocument error:', error)
    return { success: false, error }
  }
}

export async function getScoutProfile(userId) {
  try {
    const { data, error } = await supabase
      .from('scout_profiles')
      .select('*')
      .eq('user_id', userId)
      .single()
    if (error) throw error
    return data
  } catch (error) {
    console.error('getScoutProfile error:', error)
    return null
  }
}

export async function getScoutStatus(userId) {
  try {
    const { data, error } = await supabase
      .from('scout_profiles')
      .select('scout_status')
      .eq('user_id', userId)
      .single()
    if (error) throw error
    return data ? data.scout_status : null
  } catch (error) {
    console.error('getScoutStatus error:', error)
    return null
  }
}

// ============================================
// INSPECTION FUNCTIONS
// ============================================

export async function createInspection(
  clientId, address, date, time,
  inspectionType, propertyLink, instructions
) {
  try {
    const pricing = await getPricingByType(inspectionType)
    const { data: inspection, error } = await supabase
      .from('inspections')
      .insert({
        client_id: clientId,
        address: address,
        date: date,
        time: time,
        inspection_type: inspectionType,
        property_link: propertyLink || null,
        status: 'Posted',
        pricing_snapshot: {
          inspection_type: pricing.inspection_type,
          pay_to_scout: pricing.pay_to_scout,
          fee_excluding_gst: pricing.fee_excluding_gst,
          gst: pricing.gst,
          total: pricing.total
        }
      })
      .select()
      .single()
    if (error) throw error
    if (instructions && instructions.length > 0) {
      const instructionRows = instructions.map((inst, index) => ({
        inspection_id: inspection.id,
        text: inst.text,
        is_checked: inst.is_checked || false,
        display_order: index + 1
      }))
      const { error: instError } = await supabase
        .from('instructions')
        .insert(instructionRows)
      if (instError) throw instError
    }
    return { success: true, data: inspection }
  } catch (error) {
    console.error('createInspection error:', error)
    return { success: false, error }
  }
}

export async function getInspectionsByClient(clientId) {
  try {
    const { data, error } = await supabase
      .from('inspections')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data
  } catch (error) {
    console.error('getInspectionsByClient error:', error)
    return []
  }
}

export async function getPostedInspections() {
  try {
    const { data, error } = await supabase
      .from('inspections')
      .select('*')
      .eq('status', 'Posted')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data
  } catch (error) {
    console.error('getPostedInspections error:', error)
    return []
  }
}

export async function getInspectionsByScout(scoutId) {
  try {
    const { data, error } = await supabase
      .from('inspections')
      .select('*')
      .eq('scout_id', scoutId)
      .neq('client_id', scoutId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data
  } catch (error) {
    console.error('getInspectionsByScout error:', error)
    return []
  }
}

export async function getInspectionById(inspectionId) {
  try {
    const { data, error } = await supabase
      .from('inspections')
      .select(`
        *,
        instructions (*),
        captures (*),
        payments (*)
      `)
      .eq('id', inspectionId)
      .single()
    if (error) throw error
    return data
  } catch (error) {
    console.error('getInspectionById error:', error)
    return null
  }
}

export async function getInspectionsByClientAndStatus(clientId, status) {
  try {
    const { data, error } = await supabase
      .from('inspections')
      .select('*')
      .eq('client_id', clientId)
      .eq('status', status)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data
  } catch (error) {
    console.error('getInspectionsByClientAndStatus error:', error)
    return []
  }
}

export async function getInspectionsByScoutAndStatus(scoutId, status) {
  try {
    const { data, error } = await supabase
      .from('inspections')
      .select('*')
      .eq('scout_id', scoutId)
      .eq('status', status)
      .neq('client_id', scoutId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data
  } catch (error) {
    console.error('getInspectionsByScoutAndStatus error:', error)
    return []
  }
}

export async function acceptInspection(inspectionId, scoutId) {
  try {
    const { data: inspection } = await supabase
      .from('inspections')
      .select('client_id')
      .eq('id', inspectionId)
      .single()
    if (inspection.client_id === scoutId) {
      return {
        success: false,
        error: 'Scout cannot accept their own inspection'
      }
    }
    const { data, error } = await supabase
      .from('inspections')
      .update({
        scout_id: scoutId,
        status: 'Accepted',
        updated_at: new Date().toISOString()
      })
      .eq('id', inspectionId)
      .eq('status', 'Posted')
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('acceptInspection error:', error)
    return { success: false, error }
  }
}

export async function saveInspectionProgress(inspectionId) {
  try {
    const { data, error } = await supabase
      .from('inspections')
      .update({
        status: 'InProgress',
        updated_at: new Date().toISOString()
      })
      .eq('id', inspectionId)
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('saveInspectionProgress error:', error)
    return { success: false, error }
  }
}

export async function submitInspection(inspectionId) {
  try {
    const { data, error } = await supabase
      .from('inspections')
      .update({
        status: 'Completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', inspectionId)
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('submitInspection error:', error)
    return { success: false, error }
  }
}

export async function releasePayment(inspectionId, clientId) {
  try {
    const { data, error } = await supabase
      .from('inspections')
      .update({
        status: 'PendingPayment',
        updated_at: new Date().toISOString()
      })
      .eq('id', inspectionId)
      .eq('client_id', clientId)
      .eq('status', 'Completed')
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('releasePayment error:', error)
    return { success: false, error }
  }
}

export async function markInspectionPaid(inspectionId) {
  try {
    const { data, error } = await supabase
      .from('inspections')
      .update({
        status: 'Paid',
        updated_at: new Date().toISOString()
      })
      .eq('id', inspectionId)
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('markInspectionPaid error:', error)
    return { success: false, error }
  }
}

export async function disputeInspection(inspectionId, disputeReason) {
  try {
    const { data, error } = await supabase
      .from('inspections')
      .update({
        status: 'Disputed',
        dispute_reason: disputeReason,
        updated_at: new Date().toISOString()
      })
      .eq('id', inspectionId)
      .eq('status', 'Completed')
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('disputeInspection error:', error)
    return { success: false, error }
  }
}

export async function cancelInspection(inspectionId, clientId) {
  try {
    const { data, error } = await supabase
      .from('inspections')
      .update({
        status: 'Cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: clientId,
        updated_at: new Date().toISOString()
      })
      .eq('id', inspectionId)
      .eq('client_id', clientId)
      .eq('status', 'Posted')
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('cancelInspection error:', error)
    return { success: false, error }
  }
}

export async function updateInstructions(inspectionId, instructions) {
  try {
    const updates = instructions.map(inst =>
      supabase
        .from('instructions')
        .update({ is_checked: inst.is_checked })
        .eq('id', inst.id)
    )
    await Promise.all(updates)
    return { success: true }
  } catch (error) {
    console.error('updateInstructions error:', error)
    return { success: false, error }
  }
}

// ============================================
// CAPTURE FUNCTIONS
// ============================================

export async function addCapture(
  inspectionId, scoutId, captureType,
  videoUrl, fileName, fileSizeBytes,
  gpsLatitude, gpsLongitude, gpsAddress
) {
  try {
    const { data, error } = await supabase
      .from('captures')
      .insert({
        inspection_id: inspectionId,
        scout_id: scoutId,
        capture_type: captureType,
        video_url: videoUrl,
        file_name: fileName,
        file_size_bytes: fileSizeBytes || null,
        gps_latitude: gpsLatitude || null,
        gps_longitude: gpsLongitude || null,
        gps_address: gpsAddress || null
      })
      .select()
      .single()
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('addCapture error:', error)
    return { success: false, error }
  }
}

export async function getCapturesByInspection(inspectionId) {
  try {
    const { data, error } = await supabase
      .from('captures')
      .select('*')
      .eq('inspection_id', inspectionId)
      .eq('is_deleted', false)
      .eq('is_replaced', false)
      .order('capture_type', { ascending: true })
      .order('recorded_at', { ascending: true })
    if (error) throw error
    return data
  } catch (error) {
    console.error('getCapturesByInspection error:', error)
    return []
  }
}

export async function getCapturesByType(inspectionId, captureType) {
  try {
    const { data, error } = await supabase
      .from('captures')
      .select('*')
      .eq('inspection_id', inspectionId)
      .eq('capture_type', captureType)
      .eq('is_deleted', false)
      .eq('is_replaced', false)
      .order('recorded_at', { ascending: true })
    if (error) throw error
    return data
  } catch (error) {
    console.error('getCapturesByType error:', error)
    return []
  }
}

export async function replaceCapture(
  inspectionId, captureId, newVideoUrl,
  newFileName, newFileSizeBytes,
  gpsLatitude, gpsLongitude, gpsAddress
) {
  try {
    const { error: oldError } = await supabase
      .from('captures')
      .update({ is_replaced: true })
      .eq('id', captureId)
    if (oldError) throw oldError
    const { data, error } = await supabase
      .from('captures')
      .insert({
        inspection_id: inspectionId,
        video_url: newVideoUrl,
        file_name: newFileName,
        file_size_bytes: newFileSizeBytes || null,
        gps_latitude: gpsLatitude || null,
        gps_longitude: gpsLongitude || null,
        gps_address: gpsAddress || null
      })
      .select()
      .single()
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('replaceCapture error:', error)
    return { success: false, error }
  }
}

export async function deleteCapture(captureId) {
  try {
    const { data, error } = await supabase
      .from('captures')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString()
      })
      .eq('id', captureId)
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('deleteCapture error:', error)
    return { success: false, error }
  }
}

// ============================================
// PAYMENT FUNCTIONS
// ============================================

export async function createPayment(
  inspectionId, clientId, scoutId, pricingSnapshot
) {
  try {
    const { data, error } = await supabase
      .from('payments')
      .insert({
        inspection_id: inspectionId,
        client_id: clientId,
        scout_id: scoutId,
        amount: pricingSnapshot.total,
        scout_payout: pricingSnapshot.pay_to_scout,
        spekto_fee_ex_gst: pricingSnapshot.fee_excluding_gst,
        gst: pricingSnapshot.gst,
        currency: 'AUD',
        status: 'Pending',
        released_by: clientId,
        released_at: new Date().toISOString()
      })
      .select()
      .single()
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('createPayment error:', error)
    return { success: false, error }
  }
}

export async function getPaymentsByClient(clientId) {
  try {
    const { data, error } = await supabase
      .from('payments')
      .select(`
        *,
        inspections (address, inspection_type, date, time)
      `)
      .eq('client_id', clientId)
      .in('status', [
        'Pending', 'Completed', 'Disputed', 'Refunded'
      ])
      .order('created_at', { ascending: false })
    if (error) throw error
    return data
  } catch (error) {
    console.error('getPaymentsByClient error:', error)
    return []
  }
}

export async function getPaymentsByScout(scoutId) {
  try {
    const { data, error } = await supabase
      .from('payments')
      .select(`
        *,
        inspections (address, inspection_type, date, time)
      `)
      .eq('scout_id', scoutId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data
  } catch (error) {
    console.error('getPaymentsByScout error:', error)
    return []
  }
}

export async function getPaymentByInspection(inspectionId) {
  try {
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('inspection_id', inspectionId)
      .single()
    if (error) throw error
    return data
  } catch (error) {
    console.error('getPaymentByInspection error:', error)
    return null
  }
}

export async function updatePaymentStatus(
  paymentId, status,
  stripePaymentIntentId, stripeTransferId
) {
  try {
    const { data, error } = await supabase
      .from('payments')
      .update({
        status: status,
        stripe_payment_intent_id: stripePaymentIntentId || null,
        stripe_transfer_id: stripeTransferId || null,
        paid_at: status === 'Completed'
          ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      })
      .eq('id', paymentId)
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('updatePaymentStatus error:', error)
    return { success: false, error }
  }
}

// ============================================
// NOTIFICATION FUNCTIONS
// ============================================

export async function createNotification(
  userId, type, inspectionId, message
) {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        type: type,
        inspection_id: inspectionId || null,
        message: message,
        is_read: false
      })
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('createNotification error:', error)
    return { success: false, error }
  }
}

export async function getNotificationsByUser(userId) {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data
  } catch (error) {
    console.error('getNotificationsByUser error:', error)
    return []
  }
}

export async function markNotificationRead(notificationId) {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('markNotificationRead error:', error)
    return { success: false, error }
  }
}

export async function markAllNotificationsRead(userId) {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false)
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('markAllNotificationsRead error:', error)
    return { success: false, error }
  }
}

export async function getUnreadNotificationCount(userId) {
  try {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false)
    if (error) throw error
    return count
  } catch (error) {
    console.error('getUnreadNotificationCount error:', error)
    return 0
  }
}

// ============================================
// DISPUTE FUNCTIONS
// ============================================

export async function createDispute(
  inspectionId, raisedBy, disputeType,
  reason, description
) {
  try {
    const dueAt = new Date()
    dueAt.setHours(dueAt.getHours() + 48)
    const { data, error } = await supabase
      .from('disputes')
      .insert({
        inspection_id: inspectionId,
        raised_by: raisedBy,
        dispute_type: disputeType,
        reason: reason,
        description: description || null,
        status: 'Submitted',
        priority: 'Medium',
        due_at: dueAt.toISOString()
      })
      .select()
      .single()
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('createDispute error:', error)
    return { success: false, error }
  }
}

export async function getDisputesByUser(userId) {
  try {
    const { data, error } = await supabase
      .from('disputes')
      .select(`
        *,
        inspections (address, date, time, inspection_type)
      `)
      .eq('raised_by', userId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data
  } catch (error) {
    console.error('getDisputesByUser error:', error)
    return []
  }
}

export async function getDisputeById(disputeId) {
  try {
    const { data, error } = await supabase
      .from('disputes')
      .select(`
        *,
        inspections (*),
        dispute_messages (*),
        dispute_timeline (*)
      `)
      .eq('id', disputeId)
      .single()
    if (error) throw error
    return data
  } catch (error) {
    console.error('getDisputeById error:', error)
    return null
  }
}

export async function getAllDisputes() {
  try {
    const { data, error } = await supabase
      .from('disputes')
      .select(`
        *,
        inspections (address, inspection_type, date, time),
        users!raised_by (first_name, last_name, role)
      `)
      .order('due_at', { ascending: true })
    if (error) throw error
    return data
  } catch (error) {
    console.error('getAllDisputes error:', error)
    return []
  }
}

export async function updateDisputeStatus(
  disputeId, status, notes
) {
  try {
    const { data, error } = await supabase
      .from('disputes')
      .update({
        status: status,
        updated_at: new Date().toISOString()
      })
      .eq('id', disputeId)
    if (error) throw error
    await supabase
      .from('dispute_timeline')
      .insert({
        dispute_id: disputeId,
        changed_by_type: 'admin',
        changed_by_id: 'system',
        new_status: status,
        notes: notes || null
      })
    return { success: true, data }
  } catch (error) {
    console.error('updateDisputeStatus error:', error)
    return { success: false, error }
  }
}

export async function resolveDispute(
  disputeId, resolution,
  resolutionNotes, resolvedBy
) {
  try {
    const { data, error } = await supabase
      .from('disputes')
      .update({
        status: 'Resolved',
        resolution: resolution,
        resolution_notes: resolutionNotes || null,
        resolved_by: resolvedBy,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', disputeId)
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('resolveDispute error:', error)
    return { success: false, error }
  }
}

export async function sendDisputeMessage(
  disputeId, sentByType, sentById,
  message, messageType, isInternal
) {
  try {
    const { data, error } = await supabase
      .from('dispute_messages')
      .insert({
        dispute_id: disputeId,
        sent_by_type: sentByType,
        sent_by_id: sentById,
        message: message,
        message_type: messageType || 'FreeFormFollowUp',
        is_internal: isInternal || false
      })
      .select()
      .single()
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('sendDisputeMessage error:', error)
    return { success: false, error }
  }
}

export async function markDisputeReadByClient(disputeId) {
  try {
    const { data, error } = await supabase
      .from('disputes')
      .update({
        client_last_read_at: new Date().toISOString()
      })
      .eq('id', disputeId)
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('markDisputeReadByClient error:', error)
    return { success: false, error }
  }
}

export async function markDisputeReadByScout(disputeId) {
  try {
    const { data, error } = await supabase
      .from('disputes')
      .update({
        scout_last_read_at: new Date().toISOString()
      })
      .eq('id', disputeId)
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('markDisputeReadByScout error:', error)
    return { success: false, error }
  }
}

// ============================================
// PAYOUT BATCH FUNCTIONS
// ============================================

export async function getCurrentOpenBatch() {
  try {
    const { data, error } = await supabase
      .from('payout_batches')
      .select('*')
      .eq('status', 'Collecting')
      .single()
    if (error) throw error
    return data
  } catch (error) {
    console.error('getCurrentOpenBatch error:', error)
    return null
  }
}

export async function addInspectionToBatch(
  batchId, scoutId, paymentId,
  inspectionId, scoutPayout, stripeAccountId
) {
  try {
    const { data: inspection } = await supabase
      .from('inspections')
      .select('status')
      .eq('id', inspectionId)
      .single()
    if (inspection.status === 'Disputed') {
      return {
        success: false,
        error: 'Cannot add disputed inspection to batch'
      }
    }
    if (inspection.status !== 'PendingPayment') {
      return {
        success: false,
        error: 'Only PendingPayment inspections can enter batch'
      }
    }
    const { data, error } = await supabase
      .from('payout_batch_items')
      .insert({
        batch_id: batchId,
        scout_id: scoutId,
        payment_id: paymentId,
        inspection_id: inspectionId,
        scout_payout: scoutPayout,
        stripe_account_id: stripeAccountId,
        status: 'Pending'
      })
      .select()
      .single()
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('addInspectionToBatch error:', error)
    return { success: false, error }
  }
}

export async function getBatchItems(batchId) {
  try {
    const { data, error } = await supabase
      .from('payout_batch_items')
      .select(`
        *,
        inspections (address, inspection_type),
        users!scout_id (first_name, last_name)
      `)
      .eq('batch_id', batchId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return data
  } catch (error) {
    console.error('getBatchItems error:', error)
    return []
  }
}

// ============================================
// MARKETPLACE FUNCTIONS
// ============================================

export async function searchMarketplace(searchQuery) {
  try {
    const { data, error } = await supabase
      .from('marketplace_listings')
      .select(`
        *,
        captures (
          video_url, recorded_at,
          gps_latitude, gps_longitude
        )
      `)
      .eq('status', 'Active')
      .ilike('address', `%${searchQuery}%`)
      .gt('expires_at', new Date().toISOString())
      .order('recorded_at', { ascending: false })
    if (error) throw error
    return data
  } catch (error) {
    console.error('searchMarketplace error:', error)
    return []
  }
}

export async function createMarketplaceListing(
  captureId, inspectionId, address,
  suburb, state, postcode,
  latitude, longitude, recordedAt
) {
  try {
    const { data: mpPricing } = await supabase
      .from('marketplace_pricing')
      .select('*')
      .eq('id', 'standard')
      .single()
    const expiresAt = new Date()
    expiresAt.setDate(
      expiresAt.getDate() + mpPricing.listing_duration_days
    )
    const { data, error } = await supabase
      .from('marketplace_listings')
      .insert({
        capture_id: captureId,
        inspection_id: inspectionId,
        address: address,
        suburb: suburb,
        state: state,
        postcode: postcode,
        latitude: latitude || null,
        longitude: longitude || null,
        recorded_at: recordedAt,
        price: mpPricing.price,
        gst: mpPricing.gst,
        price_ex_gst: mpPricing.price_ex_gst,
        status: 'Active',
        expires_at: expiresAt.toISOString()
      })
      .select()
      .single()
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('createMarketplaceListing error:', error)
    return { success: false, error }
  }
}

export async function createMarketplacePurchase(
  listingId, captureId, buyerId, amount, gst
) {
  try {
    const { data: mpPricing } = await supabase
      .from('marketplace_pricing')
      .select('access_duration_hours, max_downloads')
      .eq('id', 'standard')
      .single()
    const accessExpiry = new Date()
    accessExpiry.setHours(
      accessExpiry.getHours() + mpPricing.access_duration_hours
    )
    const { data, error } = await supabase
      .from('marketplace_purchases')
      .insert({
        listing_id: listingId,
        capture_id: captureId,
        buyer_id: buyerId,
        amount: amount,
        gst: gst,
        amount_ex_gst: amount - gst,
        status: 'Pending',
        access_expires_at: accessExpiry.toISOString(),
        max_downloads: mpPricing.max_downloads
      })
      .select()
      .single()
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('createMarketplacePurchase error:', error)
    return { success: false, error }
  }
}

export async function getMyMarketplacePurchases(buyerId) {
  try {
    const { data, error } = await supabase
      .from('marketplace_purchases')
      .select(`
        *,
        marketplace_listings (
          address, suburb, recorded_at
        ),
        captures (video_url, file_name)
      `)
      .eq('buyer_id', buyerId)
      .eq('status', 'Completed')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data
  } catch (error) {
    console.error('getMyMarketplacePurchases error:', error)
    return []
  }
}

export async function logMarketplaceSearch(
  searchQuery, resultsCount, searcherId
) {
  try {
    const { data, error } = await supabase
      .from('marketplace_searches')
      .insert({
        search_query: searchQuery,
        results_count: resultsCount,
        searcher_id: searcherId || null
      })
    if (error) throw error
    return { success: true, data }
  } catch (error) {
    console.error('logMarketplaceSearch error:', error)
    return { success: false, error }
  }
}
