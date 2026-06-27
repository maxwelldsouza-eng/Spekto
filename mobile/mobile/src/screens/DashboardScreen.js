import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, Alert, Dimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { supabase } from '../config/supabase'
import { COLORS, SHADOWS } from '../theme'
import StatusBadge from '../components/StatusBadge'
import LoadingView from '../components/LoadingView'

const TABS = ['Available', 'Active', 'Completed']

const TYPE_LABELS = {
  external: 'External',
  internal: 'Internal',
  internalExternal: 'Int + Ext',
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatPay(snapshot) {
  if (!snapshot?.pay_to_scout) return null
  return `$${parseFloat(snapshot.pay_to_scout).toFixed(2)}`
}

export default function DashboardScreen({ navigation }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [rtw, setRtw] = useState(null)
  const [ratings, setRatings] = useState(null)
  const [activeTab, setActiveTab] = useState('Available')
  const [available, setAvailable] = useState([])
  const [active, setActive] = useState([])
  const [completed, setCompleted] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [radius, setRadius] = useState(20)

  const load = useCallback(async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) return

    const [userRes, profileRes, rtwRes, ratingsRes] = await Promise.all([
      supabase.from('users').select('*').eq('id', authUser.id).single(),
      supabase.from('scout_profiles').select('*').eq('user_id', authUser.id).maybeSingle(),
      supabase.from('rights_to_work').select('*').eq('scout_id', authUser.id).eq('is_current', true).maybeSingle(),
      supabase.from('scout_rating_summary').select('*').eq('scout_id', authUser.id).maybeSingle(),
    ])

    setUser(userRes.data)
    setProfile(profileRes.data)
    setRtw(rtwRes.data)
    setRatings(ratingsRes.data)

    await loadJobs(authUser.id, profileRes.data, radius)
    setLoading(false)
  }, [radius])

  const loadJobs = async (userId, prof, rad) => {
    const [availRes, activeRes, completedRes] = await Promise.all([
      loadAvailable(userId, prof, rad),
      supabase.from('inspections').select('*').eq('scout_id', userId)
        .in('status', ['Accepted', 'InProgress']).order('date', { ascending: true }),
      supabase.from('inspections').select('*').eq('scout_id', userId)
        .in('status', ['Completed', 'PendingPayment', 'Paid', 'Disputed'])
        .order('created_at', { ascending: false }),
    ])
    setAvailable(availRes || [])
    setActive(activeRes.data || [])
    setCompleted(completedRes.data || [])
  }

  const loadAvailable = async (userId, prof, rad) => {
    if (prof?.home_lat && prof?.home_lng) {
      const { data } = await supabase.rpc('get_inspections_within_radius', {
        scout_lat: prof.home_lat,
        scout_lng: prof.home_lng,
        radius_km: rad,
      })
      return (data || []).filter(j => j.client_id !== userId && j.status === 'Posted')
    }
    const { data } = await supabase.from('inspections').select('*')
      .eq('status', 'Posted').neq('client_id', userId).order('date', { ascending: true })
    return data || []
  }

  useEffect(() => { load() }, [load])

  const onRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const isOnboarded = () => {
    if (!profile) return false
    const idOk = profile.id_verified === true
    const rtwOk = rtw && (rtw.vsure_status?.startsWith('verified') || rtw.vsure_status === 'citizen_pr' || rtw.admin_decision === 'allowed')
    const stripeOk = profile.stripe_connect_status === 'Active'
    const addrOk = !!profile.home_address
    return idOk && rtwOk && stripeOk && addrOk
  }

  const onboardingSteps = () => {
    if (!profile) return []
    return [
      {
        key: 'id',
        label: 'Verify your identity',
        done: profile.id_verified === true,
        icon: 'card-account-details-outline',
      },
      {
        key: 'rtw',
        label: 'Right to work check',
        done: !!(rtw && (rtw.vsure_status?.startsWith('verified') || rtw.vsure_status === 'citizen_pr' || rtw.admin_decision === 'allowed')),
        icon: 'file-check-outline',
      },
      {
        key: 'stripe',
        label: 'Set up payout account',
        done: profile.stripe_connect_status === 'Active',
        icon: 'bank-outline',
      },
      {
        key: 'address',
        label: 'Add your home address',
        done: !!profile.home_address,
        icon: 'map-marker-outline',
      },
    ]
  }

  const currentData = activeTab === 'Available' ? available : activeTab === 'Active' ? active : completed

  const renderHeader = () => (
    <View>
      {/* Greeting */}
      <View style={styles.greetingRow}>
        <View>
          <Text style={styles.greeting}>
            {user ? `Hi, ${user.first_name}` : 'Welcome back'}
          </Text>
          {ratings?.average_rating ? (
            <Text style={styles.ratingText}>
              ⭐ {parseFloat(ratings.average_rating).toFixed(1)} ({ratings.total_ratings} ratings)
            </Text>
          ) : null}
        </View>
      </View>

      {/* Onboarding card */}
      {!isOnboarded() && profile && (
        <View style={[styles.card, styles.onboardCard]}>
          <Text style={styles.onboardTitle}>Complete your profile</Text>
          <Text style={styles.onboardSub}>Finish these steps to start accepting jobs</Text>
          {onboardingSteps().map(step => (
            <View key={step.key} style={styles.stepRow}>
              <View style={[styles.stepIcon, step.done && styles.stepIconDone]}>
                <MaterialCommunityIcons
                  name={step.done ? 'check' : step.icon}
                  size={16}
                  color={step.done ? COLORS.white : COLORS.purple}
                />
              </View>
              <Text style={[styles.stepLabel, step.done && styles.stepLabelDone]}>
                {step.label}
              </Text>
            </View>
          ))}
          <TouchableOpacity
            style={styles.onboardBtn}
            onPress={() => navigation.navigate('Settings')}
          >
            <Text style={styles.onboardBtnText}>Go to Settings →</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Stats bar */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statNum}>{available.length}</Text>
          <Text style={styles.statLabel}>Available</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statNum}>{active.length}</Text>
          <Text style={styles.statLabel}>Active</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statNum}>{completed.filter(j => j.status === 'Paid').length}</Text>
          <Text style={styles.statLabel}>Paid</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Radius info for available tab */}
      {activeTab === 'Available' && profile?.home_address && (
        <View style={styles.radiusRow}>
          <MaterialCommunityIcons name="map-marker-radius-outline" size={14} color={COLORS.textMuted} />
          <Text style={styles.radiusText}>Within {radius} km of your home</Text>
          <TouchableOpacity onPress={() => setRadius(r => r === 20 ? 50 : r === 50 ? 5 : 20)}>
            <Text style={styles.radiusChange}>Change</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )

  const renderJob = ({ item }) => {
    const isAvailable = item.status === 'Posted'
    return (
      <TouchableOpacity
        style={[styles.card, styles.jobCard]}
        onPress={() => navigation.navigate('InspectionDetail', { inspectionId: item.id })}
        activeOpacity={0.7}
      >
        <View style={styles.jobTop}>
          <View style={styles.jobLeft}>
            <Text style={styles.jobDate}>{formatDate(item.date)}</Text>
            <Text style={styles.jobRef}>{item.ref_number}</Text>
          </View>
          <StatusBadge status={item.status} small />
        </View>

        <Text style={styles.jobAddress} numberOfLines={2}>{item.address}</Text>

        <View style={styles.jobBottom}>
          <View style={styles.typeBadge}>
            <Text style={styles.typeText}>{TYPE_LABELS[item.inspection_type] || item.inspection_type}</Text>
          </View>
          {item.time ? <Text style={styles.jobTime}>{item.time}</Text> : null}
          {item.pricing_snapshot?.pay_to_scout ? (
            <View style={styles.payBadge}>
              <Text style={styles.payText}>{formatPay(item.pricing_snapshot)}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.jobAction}>
          <Text style={styles.jobActionText}>
            {isAvailable ? 'View & Accept →' : 'View Details →'}
          </Text>
        </View>
      </TouchableOpacity>
    )
  }

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <MaterialCommunityIcons name="clipboard-text-outline" size={48} color={COLORS.border} />
      <Text style={styles.emptyText}>
        {activeTab === 'Available' ? 'No jobs available right now' :
          activeTab === 'Active' ? 'No active jobs' : 'No completed jobs yet'}
      </Text>
    </View>
  )

  if (loading) return <LoadingView message="Loading jobs…" />

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={currentData}
        keyExtractor={item => item.id}
        renderItem={renderJob}
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
  greetingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  greeting: { fontSize: 22, fontFamily: 'DMSans_800ExtraBold', color: COLORS.dark },
  ratingText: { fontSize: 13, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', marginTop: 2 },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    ...SHADOWS.card,
  },
  onboardCard: { borderLeftWidth: 3, borderLeftColor: COLORS.purple, marginBottom: 16 },
  onboardTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: COLORS.dark, marginBottom: 4 },
  onboardSub: { fontSize: 13, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', marginBottom: 12 },
  stepRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  stepIcon: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: COLORS.purpleLight,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 10,
  },
  stepIconDone: { backgroundColor: COLORS.green },
  stepLabel: { fontSize: 14, fontFamily: 'Inter_400Regular', color: COLORS.text, flex: 1 },
  stepLabelDone: { color: COLORS.textMuted, textDecorationLine: 'line-through' },
  onboardBtn: { marginTop: 8 },
  onboardBtnText: { color: COLORS.purple, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    ...SHADOWS.card,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 24, fontFamily: 'DMSans_800ExtraBold', color: COLORS.purple },
  statLabel: { fontSize: 12, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', marginTop: 2 },
  statDivider: { width: 1, backgroundColor: COLORS.border },
  tabRow: { flexDirection: 'row', backgroundColor: COLORS.white, borderRadius: 10, padding: 4, marginBottom: 12 },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  tabActive: { backgroundColor: COLORS.purple },
  tabText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: COLORS.textMuted },
  tabTextActive: { color: COLORS.white },
  radiusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  radiusText: { fontSize: 12, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', flex: 1 },
  radiusChange: { fontSize: 12, color: COLORS.purple, fontFamily: 'Inter_600SemiBold' },
  jobCard: { padding: 14 },
  jobTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  jobLeft: {},
  jobDate: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: COLORS.text },
  jobRef: { fontSize: 11, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', marginTop: 1 },
  jobAddress: { fontSize: 15, fontFamily: 'Inter_500Medium', color: COLORS.dark, marginBottom: 10 },
  jobBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  typeBadge: {
    backgroundColor: COLORS.purpleLight,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 20,
  },
  typeText: { fontSize: 11, color: COLORS.purple, fontFamily: 'Inter_600SemiBold' },
  jobTime: { fontSize: 12, color: COLORS.textMuted, fontFamily: 'Inter_400Regular' },
  payBadge: {
    backgroundColor: COLORS.greenLight,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 20, marginLeft: 'auto',
  },
  payText: { fontSize: 12, color: '#166534', fontFamily: 'Inter_700Bold' },
  jobAction: { marginTop: 10, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10 },
  jobActionText: { fontSize: 13, color: COLORS.purple, fontFamily: 'Inter_600SemiBold' },
  emptyContainer: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', textAlign: 'center' },
})
