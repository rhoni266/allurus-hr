<?php

namespace App\Delivery;

/** The provider's payload can't be normalised. The event is kept (failed) for replay. */
final class InvalidDeliveryPayload extends \InvalidArgumentException {}
