import { Box, Flex, HStack, Icon, Text, Button } from '@chakra-ui/react';
import { LogOut, TriangleAlert, Mic, MicOff, Maximize2 } from 'lucide-react';

const isInExtensionPanel = () =>
  typeof chrome !== 'undefined' && !!chrome.runtime?.id && window.innerWidth < 600;
import ControlBar from '@/components/ControlBar';
import { StreamAudio } from '@/components/MediaStreamElement';
import ScreenStage from '@/components/ScreenStage';
import { useWatchRoom } from '@/hooks/useWatchRoom';

interface RoomScreenProps {
  roomCode: string;
  maxPeers: number;
  onLeave: () => void;
}

export default function RoomScreen({ roomCode, maxPeers, onLeave }: RoomScreenProps) {
  const room = useWatchRoom(roomCode, maxPeers);
  const connected = room.status === 'connected';

  let statusLabel: string;
  if (room.status === 'error') statusLabel = 'Disconnected';
  else if (room.status === 'connecting') statusLabel = room.isHost ? 'Starting room' : 'Joining room';
  else if (room.partnerCount > 0) statusLabel = room.isHost ? `${room.partnerCount} watching` : 'Watching live';
  else statusLabel = room.isHost ? 'Waiting for viewers' : 'Connected';

  const dotColor =
    room.status === 'error' ? 'red.400' :
    connected ? 'green.400' : 'yellow.300';

  return (
    <Flex direction="column" minH="100vh" bg="gray.950" color="whiteAlpha.900">
      <Flex
        as="header"
        wrap="wrap"
        align="center"
        justify="space-between"
        gap={3}
        borderBottom="1px solid"
        borderColor="whiteAlpha.200"
        px={{ base: 4, sm: 6 }}
        py={3}
      >
        <HStack spacing={3} minW={0}>
          <img src="/Asset/icon.png" alt="logo" style={{ height: '160px' }} />
          <Text
            borderRadius="md"
            bg="whiteAlpha.100"
            px={2}
            py={1}
            fontFamily="mono"
            fontSize="xs"
            letterSpacing="0.2em"
            color="whiteAlpha.700"
          >
            {roomCode}
          </Text>
          {room.isHost && (
            <Text fontSize="xs" color="yellow.400" fontWeight="semibold">HOST</Text>
          )}
        </HStack>
        <HStack spacing={3}>
          <HStack
            spacing={2}
            borderRadius="full"
            bg="whiteAlpha.100"
            px={3}
            py={1.5}
            fontSize="xs"
            color="whiteAlpha.700"
          >
            <Box
              h={2} w={2}
              borderRadius="full"
              bg={dotColor}
              sx={dotColor === 'yellow.300' ? { animation: 'pulse 2s infinite' } : {}}
            />
            <Text>{statusLabel}</Text>
          </HStack>
          {isInExtensionPanel() && (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Icon as={Maximize2} boxSize={4} />}
              color="whiteAlpha.700"
              _hover={{ bg: 'whiteAlpha.100', color: 'whiteAlpha.900' }}
              onClick={() => window.open(window.location.href, '_blank', `width=${screen.width},height=${screen.height},left=0,top=0`)}
            >
              <Text display={{ base: 'none', sm: 'inline' }}>Full screen</Text>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Icon as={LogOut} boxSize={4} />}
            color="whiteAlpha.700"
            _hover={{ bg: 'whiteAlpha.100', color: 'whiteAlpha.900' }}
            onClick={onLeave}
          >
            <Text display={{ base: 'none', sm: 'inline' }}>Leave</Text>
          </Button>
        </HStack>
      </Flex>

      <Flex as="main" flex={1} direction="column" gap={4} p={{ base: 4, sm: 6 }}>
        {room.status === 'error' && (
          <Banner>{room.partnerCount === 0 ? 'This room is full or does not exist.' : 'Connection lost. Refresh to rejoin.'}</Banner>
        )}
        {room.mediaError && <Banner>{room.mediaError}</Banner>}

        <ScreenStage
          roomCode={roomCode}
          isHost={room.isHost}
          partnerOnline={room.partnerOnline}
          partnerSharing={room.partnerSharing}
          partnerScreen={room.partnerScreen}
          localScreen={room.localScreen}
        />

        {/* Only host sees screen share controls, everyone gets mic */}
        {room.isHost ? (
          <ControlBar
            disabled={!connected}
            isSharing={room.isSharing}
            micOn={room.micOn}
            onToggleShare={room.isSharing ? room.stopShare : room.startShare}
            onToggleMic={room.toggleMic}
          />
        ) : (
          <MicBar disabled={!connected} micOn={room.micOn} onToggleMic={room.toggleMic} />
        )}
      </Flex>

      {/* Play all remote mic streams */}
      {room.micStreams.map((s, i) => <StreamAudio key={i} stream={s} />)}
    </Flex>
  );
}

function Banner({ children }: { children: string }) {
  return (
    <HStack
      spacing={3}
      borderRadius="xl"
      border="1px solid"
      borderColor="rgba(248,113,113,0.3)"
      bg="rgba(239,68,68,0.1)"
      px={4}
      py={3}
      fontSize="sm"
      color="red.200"
    >
      <Icon as={TriangleAlert} boxSize={4} flexShrink={0} />
      <Text>{children}</Text>
    </HStack>
  );
}

function MicBar({ disabled, micOn, onToggleMic }: { disabled: boolean; micOn: boolean; onToggleMic: () => void }) {
  return (
    <Flex
      align="center"
      justify="space-between"
      gap={3}
      borderRadius="2xl"
      border="1px solid"
      borderColor="whiteAlpha.200"
      bg="blackAlpha.600"
      p={3}
      px={4}
      backdropFilter="blur(12px)"
    >
      <Text fontSize="sm" color="whiteAlpha.600">
        {micOn ? 'Your mic is on — others can hear you.' : 'Mic is off. Turn it on to talk.'}
      </Text>
      <Button
        onClick={onToggleMic}
        isDisabled={disabled}
        leftIcon={<Icon as={micOn ? Mic : MicOff} boxSize={4} />}
        variant="outline"
        borderRadius="xl"
        size="sm"
        borderColor={micOn ? 'green.400' : 'whiteAlpha.200'}
        color={micOn ? 'green.300' : 'whiteAlpha.800'}
        bg={micOn ? 'rgba(72,187,120,0.15)' : 'transparent'}
        _hover={{ bg: micOn ? 'rgba(72,187,120,0.25)' : 'whiteAlpha.100' }}
        _active={{ transform: 'scale(0.95)' }}
        flexShrink={0}
      >
        {micOn ? 'Mic on' : 'Mic off'}
      </Button>
    </Flex>
  );
}
