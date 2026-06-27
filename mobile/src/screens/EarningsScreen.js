import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { supabase } from '../config/supabase'
import { COLORS, SHADOWS } from '../theme'
import LoadingView from '../components/LoadingView'

function formatDate(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function nextTuesday() {
  const d = new Date()
  const day = d.getDay()
  const daysUntil = day <= 2 ? 2 - day : 9 - day
  d.setDate(d.getDate() + daysUntil)
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long' })
}

const BATCH_STATUS_LABELS = {
  Paid: 'Paid',
  Processing: 'Processing',
  Pending: 'In batch',
  Failed: 'Failed',
}

const BATCH_STATUS_COLORS = {
  Paid: { bg: COLORS.greenLight, text: '#166534' },
  Processing: { bg: COLORS.blueLight, text: '#1E40AF' },
  Pending: { bg: COLORS.amberLight, text: '#92400E' },
  Failed: { bg: COLORS.redLight, text: COLORS.red },
}

export default function EarningsScreen() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState('awaiting')
  const [batchItems, setBatchItems] = useState([])
  const [unbatchedJobs, setUnbatchedJobs] = useState([])

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [batchRes, jobsRes] = await Promise.all([
      supabase.from('payout_batch_items')
        .select('id, amount, status, stripe_transfer_id, paid_at, created_at, failure_reason, inspections(id, address, date, inspection_type, ref_number)')
        .eq('scout_id', user.id)
        .order('created_at', { ascending: false }),
      supabase.from('inspections')
        .select('id, address, date, inspection_type, status, pricing_snapshot, ref_number')
        .eq('scout_id', user.id)
        .in('status', ['Completed', 'Disputed', 'PendingPayment'])
        .order('created_at', { ascending: false }),
    ])

    setBatchItems(batchRes.data || [])
    setUnbatchedJobs(jobsRes.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const onRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const paidItems = batchItems.filter(i => i.status === 'Paid')
  const inBatchItems = batchItems.filter(i => ['Pending', 'Processing'].includes(i.status))
  const failedItems = batchItems.filter(i => i.status === 'Failed')

  const totalPaid = paidItems.reduce((s, i) => s + parseFloat(i.amount || 0), 0)
  const totalAwaiting = unbatchedJobs.reduce((s, j) => s + parseFloat(j.pricing_snapshot?.pay_to_scout || 0), 0)
  const totalInBatch = inBatchItems.reduce((s, i) => s + parseFloat(i.amount || 0), 0)

  const awaitingData = [
    ...unbatchedJobs.map(j => ({ type: 'job', ...j })),
    ...inBatchItems.map(i => ({ type: 'batch', ...i })),
    ...failedItems.map(i => ({ type: 'batch', ...i })),
  ]

  const renderHeader = () => (
    <View>
      {/* Summary cards */}
      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { flex: 2 }]}>
          <Text style={styles.summaryAmount}>${totalPaid.toFixed(2)}</Text>
          <Text style={styles.summaryLabel}>Total paid out</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryAmount}>{paidItems.length}</Text>
          <Text style={styles.summaryLabel}>Payouts</Text>
        </View>
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={[styles.summaryAmount, { color: COLORS.amber }]}>${totalAwaiting.toFixed(2)}</Text>
          <Text style={styles.summaryLabel}>Awaiting release</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={[styles.summaryAmount, { color: COLORS.blue }]}>${totalInBatch.toFixed(2)}</Text>
          <Text style={styles.summaryLabel}>In batch</Text>
        </View>
      </View>

      {totalAwaiting > 0 || totalInBatch > 0 ? (
        <View style={styles.nextPayoutBanner}>
          <MaterialCommunityIcons name="calendar-clock" size={16} color={COLORS.purple} />
          <Text style={styles.nextPayoutText}>Next payout: <Text style={styles.nextPayoutDate}>{nextTuesday()}</Text></Text>
        </View>
      ) : null}

      {/* Tabs */}
      <View style={styles.tabRow}>
        {[['awaiting', 'Awaiting Payment'], ['paid', 'Paid']].map(([key, label]) => (
          <TouchableOpacity
            key={key}
            style={[styles.tab, activeTab === key && styles.tabActive]}
            onPress={() => setActiveTab(key)}
          >
            <Text style={[styles.tabText, activeTab === key && styles.tabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  )

  const renderAwaiting = ({ item }) => {
    if (item.type === 'job') {
      return (
        <View style={styles.earningCard}>
          <View style={styles.earningTop}>
            <View style={styles.earningLeft}>
              <Text style={styles.earningDate}>{formatDate(item.date)}</Text>
              <Text style={styles.earningRef}>{item.ref_number}</Text>
            </View>
            <View style={[styles.earningBadge, { backgroundColor: COLORS.amberLight }]}>
              <Text style={[styles.earningBadgeText, { color: '#92400E' }]}>Awaiting release</Text>
            </View>
          </View>
          <Text style={styles.earningAddress} numberOfLines={1}>{item.address}</Text>
          {item.pricing_snapshot?.pay_to_scout ? (
            <Text style={styles.earningAmount}>
              ${parseFloat(item.pricing_snapshot.pay_to_scout).toFixed(2)}
            </Text>
          ) : null}
          {item.status === 'Disputed' && (
            <View style={styles.disputeNotice}>
              <MaterialCommunityIcons name="alert-octagon-outline" size={13} color={COLORS.red} />
              <Text style={styles.disputeNoticeText}>Payout on hold — dispute in progress</Text>
            </View>
          )}
        </View>
      )
    }

    // batch item
    const batchColor = BATCH_STATUS_COLORS[item.status] || { bg: '#F3F4F6', text: COLORS.textMuted }
    const insp = item.inspections
    return (
      <View style={styles.earningCard}>
        <View style={styles.earningTop}>
          <View style={styles.earningLeft}>
            <Text style={styles.earningDate}>{formatDate(item.created_at)}</Text>
            {insp?.ref_number ? <Text style={styles.earningRef}>{insp.ref_number}</Text> : null}
          </View>
          <View style={[styles.earningBadge, { backgroundColor: batchColor.bg }]}>
            <Text style={[styles.earningBadgeText, { color: batchColor.text }]}>
              {BATCH_STATUS_LABELS[item.status] || item.status}
            </Text>
          </View>
        </View>
        {insp?.address ? <Text style={styles.earningAddress} numberOfLines={1}>{insp.address}</Text> : null}
        <Text style={styles.earningAmount}>${parseFloat(item.amount || 0).toFixed(2)}</Text>
        {item.failure_reason ? (
          <Text style={styles.failureText}>{item.failure_reason}</Text>
        ) : null}
      </View>
    )
  }

  const renderPaid = ({ item }) => {
    const insp = item.inspections
    return (
      <View style={styles.earningCard}>
        <View style={styles.earningTop}>
          <View style={styles.earningLeft}>
            <Text style={styles.earningDate}>{formatDate(item.paid_at)}</Text>
            {insp?.ref_number ? <Text style={styles.earningRef}>{insp.ref_number}</Text> : null}
          </View>
          <View style={[styles.earningBadge, { backgroundColor: COLORS.greenLight }]}>
            <Text style={[styles.earningBadgeText, { color: '#166534' }]}>Paid</Text>
          </View>
        </View>
        {insp?.address ? <Text style={styles.earningAddress} numberOfLines={1}>{insp.address}</Text> : null}
        <View style={styles.earningBottomRow}>
          <Text style={styles.earningAmount}>${parseFloat(item.amount || 0).toFixed(2)}</Text>
          {item.stripe_transfer_id ? (
            <Text style={styles.transferId} numberOfLines={1}>{item.stripe_transfer_id}</Text>
          ) : null}
        </View>
      </View>
    )
  }

  const renderEmpty = () => (
    <View style={styles.empty}>
      <MaterialCommunityIcons name="wallet-outline" size={48} color={COLORS.border} />
      <Text style={styles.emptyText}>
        {activeTab === 'awaiting' ? 'No pending payments' : 'No payouts yet'}
      </Text>
    </View>
  )

  if (loading) return <LoadingView message="Loading earnings…" />

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={activeTab === 'awaiting' ? awaitingData : paidItems}
        keyExtractor={item => item.id}
        renderItem={activeTab === 'awaiting' ? renderAwaiting : renderPaid}
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
  summaryRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  summaryCard: {
    flex: 1, backgroundColor: COLORS.white, borderRadius: 12, padding: 14, ...SHADOWS.card,
  },
  summaryAmount: { fontSize: 22, fontFamily: 'DMSans_800ExtraBold', color: COLORS.purple },
  summaryLabel: { fontSize: 12, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', marginTop: 2 },
  nextPayoutBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.purpleLight, borderRadius: 10, padding: 12, marginBottom: 16,
  },
  nextPayoutText: { fontSize: 13, color: COLORS.text, fontFamily: 'Inter_400Regular' },
  nextPayoutDate: { fontFamily: 'Inter_700Bold', color: COLORS.purple },
  tabRow: { flexDirection: 'row', backgroundColor: COLORS.white, borderRadius: 10, padding: 4, marginBottom: 12 },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  tabActive: { backgroundColor: COLORS.purple },
  tabText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: COLORS.textMuted },
  tabTextActive: { color: COLORS.white },
  earningCard: { backgroundColor: COLORS.white, borderRadius: 12, padding: 14, marginBottom: 10, ...SHADOWS.card },
  earningTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  earningLeft: {},
  earningDate: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: COLORS.text },
  earningRef: { fontSize: 11, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', marginTop: 1 },
  earningBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  earningBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  earningAddress: { fontSize: 14, color: COLORS.text, fontFamily: 'Inter_400Regular', marginBottom: 6 },
  earningAmount: { fontSize: 18, fontFamily: 'DMSans_800ExtraBold', color: COLORS.dark },
  earningBottomRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  transferId: { fontSize: 11, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', flex: 1, marginLeft: 8, textAlign: 'right' },
  disputeNotice: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  disputeNoticeText: { fontSize: 12, color: COLORS.red, fontFamily: 'Inter_400Regular' },
  failureText: { fontSize: 12, color: COLORS.red, fontFamily: 'Inter_400Regular', marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, color: COLORS.textMuted, fontFamily: 'Inter_400Regular' },
})
