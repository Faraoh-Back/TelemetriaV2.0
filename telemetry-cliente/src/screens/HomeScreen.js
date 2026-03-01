import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { getLatestTelemetry, logout } from '../services/api';

const HomeScreen = ({ navigation }) => {
  const [telemetryData, setTelemetryData] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  useEffect(() => {
    fetchData();
    
    // Atualizar a cada 2 segundos
    const interval = setInterval(fetchData, 2000);
    
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    const result = await getLatestTelemetry(20);
    
    if (result.success) {
      setTelemetryData(result.data);
      setLastUpdate(new Date());
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const handleLogout = () => {
    Alert.alert(
      'Sair',
      'Deseja realmente sair?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sair',
          onPress: async () => {
            await logout();
            navigation.replace('Login');
          },
        },
      ]
    );
  };

  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.signalName}>{item.signal_name}</Text>
        <Text style={styles.deviceId}>{item.device_id}</Text>
      </View>
      
      <View style={styles.cardBody}>
        <Text style={styles.value}>
          {item.value.toFixed(2)} {item.unit}
        </Text>
        <Text style={styles.timestamp}>
          {new Date(item.timestamp * 1000).toLocaleTimeString()}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Telemetria em Tempo Real</Text>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
          <Text style={styles.logoutText}>Sair</Text>
        </TouchableOpacity>
      </View>

      {lastUpdate && (
        <Text style={styles.lastUpdate}>
          Última atualização: {lastUpdate.toLocaleTimeString()}
        </Text>
      )}

      <FlatList
        data={telemetryData}
        renderItem={renderItem}
        keyExtractor={(item) => item.id.toString()}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#ff4444']}
          />
        }
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>Nenhum dado disponível</Text>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 50,
    backgroundColor: '#2a2a2a',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  logoutButton: {
    padding: 8,
  },
  logoutText: {
    color: '#ff4444',
    fontSize: 16,
  },
  lastUpdate: {
    color: '#888',
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 10,
  },
  list: {
    padding: 15,
  },
  card: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 15,
    marginBottom: 15,
    borderLeftWidth: 4,
    borderLeftColor: '#ff4444',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  signalName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  deviceId: {
    color: '#888',
    fontSize: 12,
  },
  cardBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  value: {
    color: '#4caf50',
    fontSize: 24,
    fontWeight: 'bold',
  },
  timestamp: {
    color: '#666',
    fontSize: 12,
  },
  emptyText: {
    color: '#888',
    textAlign: 'center',
    marginTop: 50,
    fontSize: 16,
  },
});

export default HomeScreen;