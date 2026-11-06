import { useRef, type ReactNode } from 'react';
import { Box, Flex, Heading, Icon, IconButton, Spinner, Text } from '@chakra-ui/react';
import { Maximize, Monitor } from 'lucide-react';
import InviteLink from '@/components/InviteLink';
import { StreamVideo } from '@/components/MediaStreamElement';

interface ScreenStageProps {
  roomCode: string;
  isHost: boolean;
  partnerOnline: boolean;
  partnerSharing: boolean;
  partnerScreen: MediaStream | null;
  localScreen: MediaStream | null;
}

function StageMessage({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <Flex direction="column" align="center" gap={4} px={6} textAlign="center">
      {icon}
      <Heading size="lg" color="whiteAlpha.900">{title}</Heading>
      {children}
    </Flex>
  );
}

export default function ScreenStage({
  roomCode,
  isHost,
  partnerOnline,
  partnerSharing,
  partnerScreen,
  localScreen,
}: ScreenStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void stageRef.current?.requestFullscreen().catch(() => {});
    }
  };

  let content: ReactNode;
  if (partnerSharing && partnerScreen) {
    content = (
      <>
        <StreamVideo stream={partnerScreen} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        <Box
          position="absolute"
          top={4}
          left={4}
          borderRadius="full"
          bg="blackAlpha.700"
          px={3}
          py={1.5}
          fontSize="xs"
          fontWeight="medium"
          color="whiteAlpha.900"
          backdropFilter="blur(8px)"
        >
          Your partner's screen
        </Box>
        <IconButton
          aria-label="Toggle fullscreen"
          icon={<Icon as={Maximize} boxSize={4} />}
          position="absolute"
          bottom={4}
          right={4}
          borderRadius="full"
          bg="blackAlpha.700"
          color="whiteAlpha.900"
          backdropFilter="blur(8px)"
          _hover={{ bg: 'blackAlpha.800' }}
          _active={{ transform: 'scale(0.95)' }}
          onClick={toggleFullscreen}
        />
      </>
    );
  } else if (localScreen) {
    content = (
      <>
        <StreamVideo stream={localScreen} muted style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        <Flex
          position="absolute"
          top={4}
          left={4}
          align="center"
          gap={2}
          borderRadius="full"
          bg="blackAlpha.700"
          px={3}
          py={1.5}
          fontSize="xs"
          fontWeight="medium"
          color="whiteAlpha.900"
          backdropFilter="blur(8px)"
        >
          <Box h={2} w={2} borderRadius="full" bg="red.500" sx={{ animation: 'pulse 2s infinite' }} />
          You are sharing your screen
        </Flex>
      </>
    );
  } else if (partnerSharing) {
    content = (
      <StageMessage icon={<Spinner color="yellow.400" size="lg" />} title="Connecting to the screen">
        <Text maxW="sm" fontSize="sm" color="whiteAlpha.600">The host is sharing. The picture will appear in a moment.</Text>
      </StageMessage>
    );
  } else if (!partnerOnline) {
    content = (
      <StageMessage title={isHost ? 'Waiting for viewers' : 'Waiting for host'}>
        {isHost && <InviteLink roomCode={roomCode} />}
        {!isHost && <Text fontSize="sm" color="whiteAlpha.600">The host hasn't started sharing yet.</Text>}
      </StageMessage>
    );
  } else {
    content = (
      <StageMessage icon={<Icon as={Monitor} boxSize={10} color="yellow.400" />} title={isHost ? 'Viewers are ready' : 'Waiting for host to share'}>
        <Text maxW="sm" fontSize="sm" color="whiteAlpha.600">
          {isHost
            ? 'Press Share screen below to start streaming.'
            : 'The host will start sharing soon.'}
        </Text>
      </StageMessage>
    );
  }

  return (
    <Box
      ref={stageRef}
      position="relative"
      display="flex"
      flex={1}
      alignItems="center"
      justifyContent="center"
      overflow="hidden"
      borderRadius="2xl"
      border="1px solid"
      borderColor="whiteAlpha.200"
      bg="black"
      minH={{ base: '16rem', sm: '24rem' }}
      boxShadow="2xl"
    >
      {content}
    </Box>
  );
}
