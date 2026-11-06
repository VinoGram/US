import { useState, type FormEvent } from 'react';
import {
  Box, Button, Flex, FormControl, FormLabel, FormErrorMessage,
  Grid, HStack, Heading, Icon, Image, Input, Text, VStack,
} from '@chakra-ui/react';
import { ArrowRight, MonitorPlay, Users, Maximize2 } from 'lucide-react';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '@/lib/roomCode';

const isInExtensionPanel = () =>
  typeof chrome !== 'undefined' && !!chrome.runtime?.id && window.innerWidth < 600;

interface LandingScreenProps {
  onEnter: (roomCode: string, maxPeers: number) => void;
}

const HERO_IMAGE_URL =
  'https://images.pexels.com/photos/4009402/pexels-photo-4009402.jpeg?auto=compress&cs=tinysrgb&h=650&w=940';

const FEATURES = [
  { icon: MonitorPlay, title: 'Share any screen', text: 'Stream a movie, streaming app, or browser tab straight from your device.' },
  { icon: Users, title: 'Watch together', text: 'Private rooms with a simple code. Share it with anyone you want to join.' },
];

export default function LandingScreen({ onEnter }: LandingScreenProps) {
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [pickingSize, setPickingSize] = useState(false);
  const [maxPeers, setMaxPeers] = useState(2);

  const handleJoin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = normalizeRoomCode(joinCode);
    if (!isValidRoomCode(code)) {
      setJoinError('Room codes are 6 letters or numbers. Check the code and try again.');
      return;
    }
    // Use max from URL if host shared a link, otherwise use 8 so the slot
    // system (not a hardcoded cap) decides if the room is full
    const urlMax = parseInt(new URLSearchParams(window.location.search).get('max') ?? '8', 10);
    const max = Number.isFinite(urlMax) && urlMax >= 2 && urlMax <= 8 ? urlMax : 8;
    onEnter(code, max);
  };

  const handleCreate = () => {
    onEnter(generateRoomCode(), maxPeers);
  };

  return (
    <Box position="relative" minH="100vh" overflow="hidden" bg="gray.950" color="whiteAlpha.900">
      <Image
        src={HERO_IMAGE_URL}
        alt=""
        position="absolute"
        inset={0}
        w="full"
        h="full"
        objectFit="cover"
        opacity={0.4}
      />
      <Box
        position="absolute"
        inset={0}
        bgGradient="linear(to-br, blackAlpha.900, blackAlpha.800, blackAlpha.600)"
      />

      <Flex
        position="relative"
        direction="column"
        minH="100vh"
        maxW="6xl"
        mx="auto"
        px={{ base: 6, sm: 10 }}
        py={8}
      >
        <HStack as="header" spacing={2.5} justify="space-between">
          <Image src="/Asset/icon.png" alt="logo" h={40} />
          {isInExtensionPanel() && (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Icon as={Maximize2} boxSize={4} />}
              color="whiteAlpha.700"
              _hover={{ bg: 'whiteAlpha.100', color: 'whiteAlpha.900' }}
              onClick={() => window.open(window.location.href, '_blank', `width=${screen.width},height=${screen.height},left=0,top=0`)}
            >
              Full screen
            </Button>
          )}
        </HStack>

        <Grid
          flex={1}
          alignItems="center"
          gap={{ base: 12, lg: 16 }}
          py={16}
          templateColumns={{ base: '1fr', lg: '1fr 1fr' }}
        >
          <VStack align="start" spacing={0} maxW="xl">
            <Heading fontSize={{ base: '4xl', sm: '6xl' }} fontWeight="semibold" lineHeight={1.1} letterSpacing="tight">
              Watch the same film with the people you love.
            </Heading>
            <Text mt={6} fontSize="lg" lineHeight="relaxed" color="whiteAlpha.700">
              Share your screen with your partner and watch side by side in real time, with a voice
              chat running alongside. Two couples, one movie, zero awkward setup.
            </Text>

            <VStack as="ul" mt={10} spacing={5} align="start" w="full">
              {FEATURES.map(({ icon: FeatureIcon, title, text }) => (
                <HStack as="li" key={title} spacing={3} align="start">
                  <Flex
                    mt={0.5}
                    h={9}
                    w={9}
                    shrink={0}
                    align="center"
                    justify="center"
                    borderRadius="lg"
                    bg="rgba(236,201,75,0.1)"
                    color="yellow.300"
                  >
                    <Icon as={FeatureIcon} boxSize={4} />
                  </Flex>
                  <Box>
                    <Text fontWeight="semibold">{title}</Text>
                    <Text mt={1} fontSize="sm" lineHeight="relaxed" color="whiteAlpha.600">{text}</Text>
                  </Box>
                </HStack>
              ))}
            </VStack>
          </VStack>

          <Box
            borderRadius="3xl"
            border="1px solid"
            borderColor="whiteAlpha.200"
            bg="blackAlpha.700"
            p={{ base: 6, sm: 8 }}
            backdropFilter="blur(12px)"
            boxShadow="2xl"
          >
            <Heading size="md" fontWeight="semibold">Start a movie night</Heading>
            <Text mt={2} fontSize="sm" color="whiteAlpha.600">Create a private room and share the code.</Text>

            {!pickingSize ? (
              <Button
                mt={6}
                w="full"
                bg="yellow.400"
                color="gray.900"
                fontWeight="semibold"
                rightIcon={<Icon as={ArrowRight} boxSize={4} />}
                _hover={{ bg: 'yellow.300' }}
                _active={{ transform: 'scale(0.98)' }}
                onClick={() => setPickingSize(true)}
              >
                Create a room
              </Button>
            ) : (
              <Box mt={6}>
                <Text fontSize="sm" fontWeight="medium" color="whiteAlpha.800" mb={3}>
                  How many people can join? (including you)
                </Text>
                <HStack spacing={2} mb={4} flexWrap="wrap">
                  {[2, 3, 4, 5, 6, 7, 8].map(n => (
                    <Button
                      key={n}
                      size="sm"
                      borderRadius="lg"
                      variant={maxPeers === n ? 'solid' : 'outline'}
                      bg={maxPeers === n ? 'yellow.400' : 'transparent'}
                      color={maxPeers === n ? 'gray.900' : 'whiteAlpha.800'}
                      borderColor={maxPeers === n ? 'yellow.400' : 'whiteAlpha.300'}
                      _hover={{ bg: maxPeers === n ? 'yellow.300' : 'whiteAlpha.100' }}
                      onClick={() => setMaxPeers(n)}
                    >
                      {n}
                    </Button>
                  ))}
                </HStack>
                <HStack spacing={2}>
                  <Button
                    flex={1}
                    bg="yellow.400"
                    color="gray.900"
                    fontWeight="semibold"
                    rightIcon={<Icon as={ArrowRight} boxSize={4} />}
                    _hover={{ bg: 'yellow.300' }}
                    _active={{ transform: 'scale(0.98)' }}
                    onClick={handleCreate}
                  >
                    Create ({maxPeers} people)
                  </Button>
                  <Button
                    variant="ghost"
                    color="whiteAlpha.600"
                    _hover={{ bg: 'whiteAlpha.100' }}
                    onClick={() => setPickingSize(false)}
                  >
                    Back
                  </Button>
                </HStack>
              </Box>
            )}

            <HStack my={7} spacing={4}>
              <Box flex={1} h="1px" bg="whiteAlpha.200" />
              <Text fontSize="xs" textTransform="uppercase" letterSpacing="widest" color="whiteAlpha.400">or join one</Text>
              <Box flex={1} h="1px" bg="whiteAlpha.200" />
            </HStack>

            <Box as="form" onSubmit={handleJoin} noValidate>
              <FormControl isInvalid={!!joinError}>
                <FormLabel fontSize="sm" fontWeight="medium" color="whiteAlpha.800">Room code</FormLabel>
                <HStack spacing={3}>
                  <Input
                    id="room-code"
                    value={joinCode}
                    onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); setJoinError(null); }}
                    maxLength={6}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="ABC123"
                    fontFamily="mono"
                    fontSize="lg"
                    textTransform="uppercase"
                    letterSpacing="0.3em"
                    bg="blackAlpha.600"
                    border="1px solid"
                    borderColor="whiteAlpha.200"
                    borderRadius="xl"
                    _focus={{ borderColor: 'yellow.400', boxShadow: '0 0 0 2px rgba(236,201,75,0.2)' }}
                    _placeholder={{ color: 'whiteAlpha.300' }}
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    borderColor="whiteAlpha.300"
                    color="whiteAlpha.900"
                    borderRadius="xl"
                    fontWeight="semibold"
                    _hover={{ bg: 'whiteAlpha.100' }}
                    _active={{ transform: 'scale(0.98)' }}
                    flexShrink={0}
                  >
                    Join
                  </Button>
                </HStack>
                <FormErrorMessage>{joinError}</FormErrorMessage>
              </FormControl>
            </Box>
          </Box>
        </Grid>
      </Flex>
    </Box>
  );
}
