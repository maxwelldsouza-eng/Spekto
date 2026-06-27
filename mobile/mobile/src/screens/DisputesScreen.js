import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { supabase } from '../config/supabase'
import { COLORS, SHADOWS } from '../theme'
import LoadingView from '../components/LoadingView'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'response', label: 'Needs Response' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'dismissed', label: 'Dismissed' },
]

const OPEN_STATUSES = ['Submitted', 'UnderReview', 'AwaitingResponse', 'DecisionMade']

function formatDate(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function slaColor(dueAt) {
  if (!dueAt) return null
  const hoursLeft = (new Date(dueAt) - new Date()) / 3600000
  if (hoursLeft < 0) return COLORS.red
  if (hoursLeft < 6) return COLORS.red
  if (hoursLeft < 24) return COLORS.amber
  return COLORS.green
}

function slaLabel(dueAt) {
  if (!dueAt) return null
  const hoursLeft = (new Date(dueAt) - new Date()) / 3600000
  if (hoursLeft < 0) return 'Overdue'
  if (hoursLeft < 1) return `${Math.round(hoursLeft * 60)}m left`
  if (hoursLeft < 24) return `${Math.round(hoursLeft)}h left`
  const days = Math.floor(hoursLeft / 24)
  return `${days}d left`
}

export default function DisputesScreen({ navigation }) {
  const [disputes, setDisputes] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState('all')
  const [userId, setUserId] = useState(null)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)

    const { data } = await supabase.from('disputes')
      .select('*, inspections(address, date, inspection_type, pricing_snapshot, scout_id, id)')
      .order('created_at', { ascending: false })

    // Filter to only disputes on inspections where the current user is the scout
    const myDisputes = (data || []).filter(d => d.inspections?.scout_id === user.id)
    setDisputes(myDisputes)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const onRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const filteredDisputes = disputes.filter(d => {
    if (filter === 'all') return true
    if (filter === 'open') return OPEN_STATUSES.includes(d.status)
    if (filter === 'response') return d.status === 'AwaitingResponse' && !d.scout_responded
    if (filter === 'resolved') return d.status === 'Resolved'
    if (filter === 'dismissed') return d.status === 'Dismissed'
    return true
  })

  const openCount = disputes.filter(d => OPEN_STATUSES.includes(d.status)).length
  const needsResponseCount = disputes.filter(d => d.status === 'AwaitingResponse' && !d.scout_responded).length
  const wonCount = disputes.filter(d => d.status === 'Resolved' && ['PaymentReleasedToScout', 'PartialPaymentToScout'].includes(d.resolution)).length
  const lostCount = disputes.filter(d => d.status === 'Resolved' && ['FullRefundToClient', 'PartialRefundToClient'].includes(d.resolution)).length

  const renderHeader = () => (
    <View>
      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{disputes.length}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statNum, { color: COLORS.red }]}>{openCount}</Text>
          <Text style={styles.statLabel}>Open</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statNum, { color: COLORS.green }]}>{wonCount}</Text>
          <Text style={styles.statLabel}>Won</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statNum, { color: COLORS.red }]}>{lostCount}</Text>
          <Text style={styles.statLabel}>Lost</Text>
        </View>
      </View>

      {/* Needs response alert */}
      {needsResponseCount > 0 && (
        <View style={styles.alertBanner}>
          <MaterialCommunityIcons name="alert-circle" size={16} color={COLORS.red} />
          <Text style={styles.alertText}>
            {needsResponseCount} dispute{needsResponseCount > 1 ? 's' : ''} need{needsResponseCount === 1 ? 's' : ''} your response
          </Text>
        </View>
      )}

      {/* Filter pills */}
      <View style={styles.filtersRow}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterPill, filter === f.key && styles.filterPillActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  )

  const renderDispute = ({ item }) => {
    const insp = item.inspections
    const isOpen = OPEN_STATUSES.includes(item.status)
    const needsResponse = item.status === 'AwaitingResponse' && !item.scout_responded
    const isResolved = item.status === 'Resolved'
    const isWon = isResolved && ['PaymentReleasedToScout', 'PartialPaymentToScout'].includes(item.resolution)
    const isLost = isResolved && ['FullRefundToClient', 'PartialRefundToClient'].includes(item.resolution)
    const sla = item.due_at && isOpen ? slaLabel(item.due_at) : null
    const slaC = item.due_at && isOpen ? slaColor(item.due_at) : null

    let borderColor = COLORS.border
    if (needsResponse) borderColor = COLORS.red
    else if (isWon) borderColor = COLORS.green
    else if (isLost) borderColor = COLORS.red
    else if (isResolved) borderColor = COLORS.textMuted

    return (
      <TouchableOpacity
        style={[styles.disputeCard, { borderLeftColor: borderColor }]}
        onPress={() => navigation.navigate('InspectionDetail', { inspectionId: insp?.id || item.inspection_id })}
        activeOpacity={0.7}
      >
        <View style={styles.disputeTop}>
          <View style={styles.disputeLeft}>
            <Text style={styles.disputeDate}>{formatDate(item.created_at)}</Text>
            <Text style={styles.disputeReason}>{item.reason}</Text>
          </View>
          <View>
            <View style={[styles.statusPill, isResolved ? styles.statusResolved : styles.statusOpen]}>
              <Text style={[styles.statusText, isResolved ? styles.statusTextResolved : styles.statusTextOpen]}>
                {item.status}
              </Text>
            </View>
            {sla && (
              <View style={[styles.slaPill, { backgroundColor: slaC + '22' }]}>
                <Text style={[styles.slaText, { color: slaC }]}>{sla}</Text>
              </View>
            )}
          </View>
        </View>

        {insp?.address ? (
          <Text style={styles.disputeAddress} numberOfLines={1}>{insp.address}</Text>
        ) : null}

        {needsResponse && (
          <View style={styles.responseNeeded}>
            <MaterialCommunityIcons name="reply" size={13} color={COLORS.red} />
            <Text style={styles.responseNeededText}>Response required — tap to reply</Text>
          </View>
        )}

        {isWon && (
          <View style={styles.resolutionBanner}>
            <MaterialCommunityIcons name="check-circle" size={13} color={COLORS.green} />
            <Text style={[styles.resolutionText, { color: '#166534' }]}>Resolved in your favour</Text>
          </View>
        )}

        {isLost && (
          <View style={[styles.resolutionBanner, { backgroundColor: COLORS.redLight }]}>
            <MaterialCommunityIcons name="close-circle" size={13} color={COLORS.red} />
            <Text style={[styles.resolutionText, { color: COLORS.red }]}>
              {item.resolution === 'FullRefundToClient' ? 'Full refund to client' : 'Partial refund to client'}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    )
  }

  const renderEmpty = () => (
    <View style={styles.empty}>
      <MaterialCommunityIcons name="shield-check-outline" size={48} color={COLORS.border} />
      <Text style={styles.emptyText}>
        {filter === 'all' ? 'No disputes' : `No ${FILTERS.find(f => f.key === filter)?.label.toLowerCase()} disputes`}
      </Text>
    </View>
  )

  if (loading) return <LoadingView message="Loading disputes…" />

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={filteredDisputes}
        keyExtractor={item => item.id}
        renderItem={renderDispute}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.purple} />}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  listContent: { padding: 16, paddingBottom: 32 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  statCard: { flex: 1, backgroundColor: COLORS.white, borderRadius: 10, padding: 12, alignItems: 'center', ...SHADOWS.card },
  statNum: { fontSize: 20, fontFamily: 'DMSans_800ExtraBold', color: COLORS.dark },
  statLabel: { fontSize: 11, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', marginTop: 1 },
  alertBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.redLight, borderRadius: 10, padding: 12, marginBottom: 14,
  },
  alertText: { fontSize: 13, color: COLORS.red, fontFamily: 'Inter_600SemiBold', flex: 1 },
  filtersRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  filterPill: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border,
  },
  filterPillActive: { backgroundColor: COLORS.purple, borderColor: COLORS.purple },
  filterText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: COLORS.textMuted },
  filterTextActive: { color: COLORS.white },
  disputeCard: {
    backgroundColor: COLORS.white, borderRadius: 12, padding: 14, marginBottom: 10,
    borderLeftWidth: 3, ...SHADOWS.card,
  },
  disputeTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  disputeLeft: { flex: 1, marginRight: 8 },
  disputeDate: { fontSize: 12, color: COLORS.textMuted, fontFamily: 'Inter_400Regular' },
  disputeReason: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: COLORS.text, marginTop: 2 },
  disputeAddress: { fontSize: 13, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', marginBottom: 8 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, marginBottom: 4 },
  statusOpen: { backgroundColor: COLORS.amberLight },
  statusResolved: { backgroundColor: COLORS.greenLight },
  statusText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  statusTextOpen: { color: '#92400E' },
  statusTextResolved: { color: '#166534' },
  slaPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  slaText: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  responseNeeded: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  responseNeededText: { fontSize: 12, color: COLORS.red, fontFamily: 'Inter_500Medium' },
  resolutionBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.greenLight, borderRadius: 8, padding: 8, marginTop: 8,
  },
  resolutionText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, color: COLORS.textMuted, fontFamily: 'Inter_400Regular' },
})
