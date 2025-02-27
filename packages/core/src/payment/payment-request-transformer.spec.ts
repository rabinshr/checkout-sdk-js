import { merge } from 'lodash';

import { getBillingAddress } from '../billing/billing-addresses.mock';
import { createInternalCheckoutSelectors, CheckoutStoreState, InternalCheckoutSelectors } from '../checkout';
import { getCheckoutStoreStateWithOrder, getCheckoutWithGiftCertificates } from '../checkout/checkouts.mock';
import { MissingDataError } from '../common/error/errors';
import { getConfig } from '../config/configs.mock';
import { getCustomer } from '../customer/customers.mock';
import { HostedFieldType } from '../hosted-form';
import { getHostedFormOrderData } from '../hosted-form/hosted-form-order-data.mock';
import { getOrder, getOrderMeta } from '../order/orders.mock';
import { getConsignment, getConsignments } from '../shipping/consignments.mock';
import { getShippingAddress } from '../shipping/shipping-addresses.mock';
import { getShippingOption } from '../shipping/shipping-options.mock';

import { getInstrumentsMeta } from './instrument/instrument.mock';
import Payment from './payment';
import { getAdyenAmex, getAuthorizenet, getPaymentMethodsMeta, getStripeV3 } from './payment-methods.mock';
import PaymentRequestTransformer from './payment-request-transformer';
import { getPayment, getPaymentRequestBody } from './payments.mock';

describe('PaymentRequestTransformer', () => {
    let state: CheckoutStoreState;
    let selectors: InternalCheckoutSelectors;
    let payment: Payment;
    let paymentRequestTransformer: PaymentRequestTransformer;

    beforeEach(() => {
        state = getCheckoutStoreStateWithOrder();
        selectors = createInternalCheckoutSelectors(state);
        payment = {
            methodId: 'methodId',
            paymentData: getPayment().paymentData,
        };
        paymentRequestTransformer = new PaymentRequestTransformer();

        jest.spyOn(selectors.billingAddress, 'getBillingAddress')
            .mockReturnValue(getBillingAddress());
        jest.spyOn(selectors.checkout, 'getCheckout')
            .mockReturnValue(getCheckoutWithGiftCertificates());
        jest.spyOn(selectors.customer, 'getCustomer')
            .mockReturnValue(getCustomer());
        jest.spyOn(selectors.order, 'getOrder')
            .mockReturnValue(getOrder());
        jest.spyOn(selectors.paymentMethods, 'getPaymentMethod')
            .mockReturnValue(getAuthorizenet());
        jest.spyOn(selectors.shippingAddress, 'getShippingAddress')
            .mockReturnValue(getShippingAddress());
        jest.spyOn(selectors.consignments, 'getConsignments')
            .mockReturnValue(getConsignments());
        jest.spyOn(selectors.consignments, 'getShippingOption')
            .mockReturnValue(getShippingOption());
        jest.spyOn(selectors.config, 'getStoreConfig')
            .mockReturnValue(getConfig().storeConfig);
        jest.spyOn(selectors.config, 'getContextConfig')
            .mockReturnValue(getConfig().context);
        jest.spyOn(selectors.instruments, 'getInstrumentsMeta')
            .mockReturnValue(getInstrumentsMeta());
        jest.spyOn(selectors.paymentMethods, 'getPaymentMethodsMeta')
            .mockReturnValue(getPaymentMethodsMeta());
        jest.spyOn(selectors.order, 'getOrderMeta')
            .mockReturnValue(getOrderMeta());
    });

    it('transform a payload to PaymentRequestBody', () => {
        const paymentRequestBodyResponse = paymentRequestTransformer.transform(payment, selectors);

        expect(paymentRequestBodyResponse).toEqual(getPaymentRequestBody());
    });

    it('throws when authToken is not generated', () => {
        jest.spyOn(selectors.payment, 'getPaymentToken')
            .mockReturnValue(undefined);

        expect(() => paymentRequestTransformer.transform(payment, selectors)).toThrow(MissingDataError);
    });

    it('returns paymentMethod as undefined when state does not have paymentMethods', () => {
        jest.spyOn(selectors.paymentMethods, 'getPaymentMethod')
            .mockReturnValue(undefined);

        const expectedPaymentRequestBody = getPaymentRequestBody();
        expectedPaymentRequestBody.paymentMethod = undefined;

        const paymentRequestBodyResponse = paymentRequestTransformer.transform(payment, selectors);

        expect(paymentRequestBodyResponse).toEqual(expectedPaymentRequestBody);
    });

    it('returns paymentMethod format when is a multi-option gateway', () => {
        const paymentMethod = getAdyenAmex();
        paymentMethod.gateway = undefined;

        jest.spyOn(selectors.paymentMethods, 'getPaymentMethod')
            .mockReturnValue(paymentMethod);

        const expectedPaymentRequestBody = getPaymentRequestBody();
        expectedPaymentRequestBody.paymentMethod = { ...paymentMethod, gateway: paymentMethod.id };

        const paymentRequestBodyResponse = paymentRequestTransformer.transform(payment, selectors);

        expect(paymentRequestBodyResponse.paymentMethod).toEqual(expectedPaymentRequestBody.paymentMethod);
    });

    it('returns paymentMethod format when contains initializationData', () => {
        const paymentMethod = getAuthorizenet();
        paymentMethod.initializationData = {
            gateway: 'authorizenet',
        };

        jest.spyOn(selectors.paymentMethods, 'getPaymentMethod')
            .mockReturnValue(paymentMethod);

        const expectedPaymentRequestBody = getPaymentRequestBody();
        expectedPaymentRequestBody.paymentMethod = {
            ...paymentMethod,
            id: paymentMethod.initializationData.gateway,
        };

        const paymentRequestBodyResponse = paymentRequestTransformer.transform(payment, selectors);

        expect(paymentRequestBodyResponse.paymentMethod).toEqual(expectedPaymentRequestBody.paymentMethod);
    });

    it('transforms from hosted form data', () => {
        const result = paymentRequestTransformer.transformWithHostedFormData(
            {
                [HostedFieldType.CardNumber]: '4111 1111 1111 1111',
                [HostedFieldType.CardCode]: '123',
                [HostedFieldType.CardName]: 'BigCommerce',
                [HostedFieldType.CardExpiry]: '10 / 20',
            },
            getHostedFormOrderData(),
            'nonce'
        );

        expect(result)
            .toEqual(merge({}, getPaymentRequestBody(), {
                payment: {
                    hostedFormNonce: 'nonce',
                },
            }));
    });

    it('transforms from hosted form data for paying with stored card', () => {
        const result = paymentRequestTransformer.transformWithHostedFormData(
            {
                [HostedFieldType.CardNumberVerification]: '4111 1111 1111 1111',
                [HostedFieldType.CardCodeVerification]: '123',
            },
            {
                ...getHostedFormOrderData(),
                payment: {
                    instrumentId: 'abcdefg',
                },
            },
            'nonce'
        );

        expect(result.payment)
            .toEqual({
                ccNumber: '4111111111111111',
                ccCvv: '123',
                hostedFormNonce: 'nonce',
                instrumentId: 'abcdefg',
            });
    });

    it('transforms from hosted form data with additional data', () => {
        const additionalAction = {
            type: 'recaptcha_v2_verification',
            data: {
                human_verification_token: 'googleRecaptchaToken',
            },
        };

        const result = paymentRequestTransformer.transformWithHostedFormData(
            {
                [HostedFieldType.CardNumber]: '4111 1111 1111 1111',
                [HostedFieldType.CardCode]: '123',
                [HostedFieldType.CardName]: 'BigCommerce',
                [HostedFieldType.CardExpiry]: '10 / 20',
            },
            {
                ...getHostedFormOrderData(),
                additionalAction,
            },
            'nonce'
        );

        expect(result)
            .toEqual(merge({}, getPaymentRequestBody(), {
                additionalAction,
                payment: {
                    hostedFormNonce: 'nonce',
                },
            }));
    });

    it('returns additinalAction within request if provided in payment parameter', () => {
        const additionalActionMock = {
            type: 'recaptcha_v2_verification',
            data: {
                human_verification_token: 'googleRecaptchaToken',
            },
        };
        payment.additionalAction = additionalActionMock;

        const paymentRequestBodyResponse = paymentRequestTransformer.transform(payment, selectors);

        expect(paymentRequestBodyResponse.additionalAction).toEqual(additionalActionMock);
    });

    describe('BOPIS', () => {
        it('should pass nothing in for shipping object', () => {
            const paymentMethod = getStripeV3();
            paymentMethod.initializationData.bopis.enabled = true;
            paymentMethod.initializationData.bopis.requiredAddress = 'none';

            jest.spyOn(selectors.paymentMethods, 'getPaymentMethod')
                .mockReturnValue(paymentMethod);

            jest.spyOn(selectors.consignments, 'getConsignments')
                .mockReturnValue([{
                    ...getConsignment(),
                    selectedShippingOption: null,
                    selectedPickupOption: {
                        pickupMethodId: 1,
                    },
                }]);

            const paymentRequestBody = paymentRequestTransformer.transform(payment, selectors);

            expect(paymentRequestBody.shippingAddress).toBeUndefined();
        });
    });
});
